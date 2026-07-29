import Anthropic from '@anthropic-ai/sdk'
import {
  type BrokerNoteData,
  isSubtotalFee,
  type NoteFee,
  type NoteTrade,
  resolveTotalFees,
} from '../../domain/broker-note.js'
import { HttpError } from '../../shared/http-error.js'
import { isoDateOrNull } from '../../shared/iso-date.js'
import { type Logger, silentLogger } from '../http.js'
import { NoteExtraction, noteExtractionJsonSchema } from './anthropic.schema.js'

/**
 * Leitura de nota de negociação em PDF pela Anthropic.
 *
 * Busca e devolve — quem grava o arquivo e a nota é o BrokerNoteService, como manda a
 * regra de camada. A extração usa saída estruturada: o modelo é obrigado a responder no
 * schema, então não sobra parsing de texto livre para dar errado.
 */

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 16_000
const TIMEOUT_MS = 120_000

/** Tipos que o modelo consegue ler. PDF é o caso normal; imagem cobre a nota escaneada. */
const MEDIA_TYPES: Readonly<Record<string, 'pdf' | 'image'>> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
}

const SYSTEM_PROMPT = [
  'Você extrai dados de notas de corretagem brasileiras (nota de negociação da B3).',
  '',
  'Regras:',
  '- A nota costuma ter várias páginas. Leia TODAS e junte as execuções de todas elas.',
  '- Cada linha da seção "Negócios realizados" é uma execução: devolva uma entrada por',
  '  linha, sem agrupar e sem somar. O mesmo papel aparece repetido — é esperado.',
  '- O ticker é o código de negociação (XPLG11, PETR4), não a descrição do papel',
  '  ("FII XP LOG"). Ignore sufixos de classe como "CI", "ON", "PN" e "UNT".',
  '- Muitas notas NÃO imprimem o código, só o nome ("CSU DIGITAL ON NM"). Nesse caso',
  '  devolva `ticker` vazio e o nome em `security`. Não deduza o código: um palpite',
  '  errado importa a empresa errada, e como quantidade e preço estão certos a',
  '  conferência do total fecha assim mesmo e ninguém percebe.',
  '- Ignore as linhas do "Resumo dos Negócios": elas são totais, não operações.',
  '- No "Resumo Financeiro", toda linha que começa com "Total" é subtotal do bloco acima',
  '  ("Total CBLC", "Total Bovespa / Soma", "Total Custos / Despesas"): nunca devolva',
  '  essas linhas em `fees`, senão a mesma taxa entra duas vezes.',
  '- Números da nota usam vírgula decimal e ponto de milhar: "1.234,56" é 1234.56.',
  '- O líquido da nota é o campo "Líquido para <data>"; devolva sempre positivo.',
  '- Confira o seu próprio resultado antes de responder: quantidade × preço de todas as',
  '  execuções, mais as taxas nas compras ou menos as taxas nas vendas, tem que dar o',
  '  líquido da nota. Se não der, revise a extração antes de responder e, se ainda assim',
  '  não fechar, descreva a diferença em checkNotes.',
].join('\n')

const USER_PROMPT =
  'Extraia os dados desta nota de negociação e confira os cálculos conforme as regras.'

export type BrokerNoteExtraction = {
  readonly note: BrokerNoteData
  /**
   * O bloco de texto da resposta, sem tocar em nada — é o JSON da saída estruturada.
   * Fica arquivado na nota: o CSV importado é derivado dele, e sem o original não dá
   * para saber depois se um número errado veio da leitura ou da nossa conta.
   */
  readonly rawResponse: string
  /** Taxas discriminadas, como a corretora listou. Vai para a prévia, não para o cálculo. */
  readonly fees: readonly NoteFee[]
  /** Conferência feita pelo próprio modelo — a nossa é a do domínio. */
  readonly checkedTotal: number
  readonly checkNotes: string
}

export type AnthropicOptions = {
  readonly apiKey: string
  readonly logger?: Logger
  readonly model?: string
  /** Só os testes mexem aqui — em produção vale o padrão do SDK. */
  readonly maxRetries?: number
}

export class AnthropicClient {
  private readonly api: Anthropic | null
  private readonly model: string
  private readonly logger: Logger

  constructor(options: AnthropicOptions) {
    this.logger = options.logger ?? silentLogger
    this.model = options.model ?? MODEL
    // Chave em branco desabilita a funcionalidade, igual à senha de autenticação.
    this.api =
      options.apiKey === ''
        ? null
        : new Anthropic({
            apiKey: options.apiKey,
            timeout: TIMEOUT_MS,
            ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
          })
  }

  get enabled(): boolean {
    return this.api !== null
  }

  async extractBrokerNote(file: Buffer, contentType: string): Promise<BrokerNoteExtraction> {
    if (this.api === null) {
      throw HttpError.badRequest('APP_ANTHROPIC_API_KEY não configurada.')
    }
    const kind = MEDIA_TYPES[contentType]
    if (kind === undefined) {
      throw HttpError.badRequest(`Tipo de arquivo não suportado: ${contentType}`)
    }

    const started = Date.now()
    const response = await this.api.messages
      .create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: noteExtractionJsonSchema() } },
        messages: [
          {
            role: 'user',
            content: [documentBlock(kind, contentType, file), { type: 'text', text: USER_PROMPT }],
          },
        ],
      })
      .catch((error: unknown) => {
        this.logger.error(`Anthropic falhou ao ler a nota: ${describe(error)}`)
        throw HttpError.badGateway(`Não foi possível ler a nota: ${describe(error)}`)
      })

    this.logger.info(
      `Nota lida em ${Date.now() - started}ms ` +
        `(${response.usage.input_tokens} tokens de entrada, ` +
        `${response.usage.output_tokens} de saída)`,
    )

    if (response.stop_reason === 'refusal') {
      throw HttpError.badGateway('O modelo recusou processar este arquivo.')
    }
    if (response.stop_reason === 'max_tokens') {
      throw HttpError.badGateway('A nota é longa demais para uma resposta só.')
    }

    const rawResponse = textBlock(response.content)
    return toExtraction(parseContent(rawResponse), rawResponse)
  }
}

function documentBlock(
  kind: 'pdf' | 'image',
  contentType: string,
  file: Buffer,
): Anthropic.ContentBlockParam {
  const data = file.toString('base64')
  return kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: contentType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
          data,
        },
      }
}

/** O texto da resposta, verbatim — é ele que fica arquivado na nota. */
function textBlock(content: readonly Anthropic.ContentBlock[]): string {
  const text = content.find((block) => block.type === 'text')?.text
  if (text === undefined || text.trim() === '') {
    throw HttpError.badGateway('A Anthropic respondeu sem conteúdo.')
  }
  return text
}

function parseContent(text: string): NoteExtraction {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw HttpError.badGateway('A resposta da Anthropic não é JSON válido.')
  }

  const parsed = NoteExtraction.safeParse(raw)
  if (!parsed.success) {
    throw HttpError.badGateway('A resposta da Anthropic veio fora do formato esperado.')
  }
  return parsed.data
}

function toExtraction(extracted: NoteExtraction, rawResponse: string): BrokerNoteExtraction {
  const date = isoDateOrNull(extracted.tradeDate)
  if (date === null) {
    throw HttpError.badGateway(`Data do pregão inválida na nota: ${extracted.tradeDate}`)
  }

  const trades: NoteTrade[] = extracted.trades.map((t) => {
    const ticker = t.ticker.trim().toUpperCase()
    return {
      ticker,
      security: t.security.trim(),
      // Aqui só existem duas origens: o que veio impresso e o que ainda não tem código.
      // Quem promove 'NONE' para 'NAME' é o service, que enxerga os ativos cadastrados.
      tickerSource: ticker === '' ? ('NONE' as const) : ('NOTE' as const),
      side: t.side,
      quantity: Math.abs(t.quantity),
      price: Math.abs(t.price),
    }
  })
  if (trades.length === 0) {
    throw HttpError.badRequest('Nenhuma operação encontrada na nota.')
  }

  // O subtotal do "Resumo Financeiro" repete parcelas que já vieram na lista; somá-lo
  // cobraria a mesma taxa duas vezes.
  const totalFees = resolveTotalFees(extracted.fees, extracted.totalFees)
  const fees = extracted.fees.filter((fee) => !isSubtotalFee(fee.label))

  const note: BrokerNoteData = {
    date,
    broker: extracted.broker.trim(),
    noteNumber: extracted.noteNumber.trim(),
    totalFees,
    totalAmount: Math.abs(extracted.totalAmount),
    trades,
  }

  return {
    note,
    rawResponse,
    fees,
    checkedTotal: extracted.checkedTotal,
    checkNotes: extracted.checkNotes,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
