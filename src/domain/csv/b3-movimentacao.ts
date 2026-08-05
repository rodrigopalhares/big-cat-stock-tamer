import { fromBrazilianDate } from '../../shared/iso-date.js'
import type { DividendType } from '../constants.js'
import type { XlsxSheet } from '../xlsx/xlsx-reader.js'
import { parseBrazilianNumber } from './br-number.js'
import type { DividendCsvRow } from './dividend-csv.js'

/**
 * Extrato "Movimentação" da B3 (área do investidor) → linhas de provento.
 * Puro: recebe a planilha já lida por `xlsx-reader` e devolve as mesmas `DividendCsvRow`
 * do CSV colado à mão, para o preview e o batch continuarem sendo um só caminho.
 *
 * O extrato mistura dinheiro com movimentação de custódia na mesma coluna. Três regras
 * separam um do outro:
 *
 * 1. **Só `Credito`.** Toda linha `Debito` do extrato é papel saindo (transferência,
 *    cessão de direitos), nunca dinheiro saindo.
 * 2. **Só linha com `Valor da Operação`.** É o que descarta a metade das linhas de
 *    `Empréstimo`: o aluguel do BTC vem em duas, uma com a quantidade de ações emprestadas
 *    e outra com a taxa recebida. Lançar as duas dobraria o provento.
 * 3. **`Valor da Operação` é o líquido; `Preço unitário` é bruto e arredondado a 3 casas.**
 *    `CSUD3 4300 × 0,172 = 739,60`, mas o crédito foi 609,13 — reconstruir o valor pela
 *    multiplicação erra em dezenas de reais por linha. Por isso o IR fica em 0 e o bruto
 *    recebe o líquido, que é o que o histórico do banco já faz.
 */

/** Cabeçalho que a B3 emite. Conferido antes de mapear — layout novo não pode passar calado. */
const EXPECTED_HEADER = [
  'ENTRADA/SAIDA',
  'DATA',
  'MOVIMENTACAO',
  'PRODUTO',
  'INSTITUICAO',
  'QUANTIDADE',
  'PRECO UNITARIO',
  'VALOR DA OPERACAO',
] as const

const COL = {
  direction: 0,
  date: 1,
  movement: 2,
  product: 3,
  institution: 4,
  amount: 7,
} as const

/** Movimentação que vira provento, já normalizada (maiúscula, sem acento). */
const MOVEMENT_TO_TYPE: Readonly<Record<string, DividendType>> = {
  RENDIMENTO: 'RENDIMENTO',
  DIVIDENDO: 'DIVIDENDO',
  'JUROS SOBRE CAPITAL PROPRIO': 'JCP',
  EMPRESTIMO: 'BTC',
  REEMBOLSO: 'DIVIDENDO',
}

/**
 * Movimentação de custódia: some sem aviso porque não é dinheiro e nunca seria provento.
 * O que **não** estiver aqui nem no mapa acima vira uma linha com aviso — extrato com
 * movimentação nova precisa aparecer na tela, não sumir na contagem.
 */
const IGNORED_MOVEMENTS: ReadonlySet<string> = new Set([
  'TRANSFERENCIA',
  'TRANSFERENCIA - LIQUIDACAO',
  'COMPRA',
  'VENDA',
  'CESSAO DE DIREITOS',
  'CESSAO DE DIREITOS - SOLICITADA',
  'DIREITOS DE SUBSCRICAO - NAO EXERCIDO',
  'DIREITO DE SUBSCRICAO',
  'RECIBO DE SUBSCRICAO',
  'SOLICITACAO DE SUBSCRICAO',
  'ATUALIZACAO',
  'BONIFICACAO EM ATIVOS',
  'DESDOBRO',
  'GRUPAMENTO',
  'FRACAO EM ATIVOS',
  'LEILAO DE FRACAO',
])

const ALREADY_IMPORTED = 'Já importado'
const REEMBOLSO_WARNING =
  'Reembolso de ação alugada — a B3 não diz se era dividendo ou JCP. Confira o tipo.'
const RESTITUICAO_WARNING =
  'Restituição de capital: reduz o preço médio, não é provento. Lance como transação R.CAP.'

export type B3MovimentacaoResult = {
  readonly rows: DividendCsvRow[]
  /** Linhas de custódia descartadas — mostradas como número para o total fechar com o arquivo. */
  readonly discarded: number
}

/**
 * Chave de duplicata. O extrato sempre vem com sobreposição de período — quem baixa o mês
 * inteiro rebaixa o que já importou. Sem ticker, data, tipo **e** valor não dá para separar
 * duplicata de provento legítimo: `MDIA3` paga 81,00 todo mês, e dois créditos de aluguel
 * no mesmo dia e mesmo papel são dois eventos de verdade, com valores diferentes.
 */
export function dividendKey(
  ticker: string,
  date: string,
  type: string,
  totalAmount: number,
): string {
  return `${ticker}|${date}|${type}|${totalAmount.toFixed(2)}`
}

export function parseB3Movimentacao(
  sheet: XlsxSheet,
  existingTickers: ReadonlySet<string>,
): B3MovimentacaoResult {
  assertHeader(sheet[0] ?? [])

  const rows: DividendCsvRow[] = []
  let discarded = 0

  for (const cells of sheet.slice(1)) {
    const movement = normalize(cell(cells, COL.movement))
    if (movement === '') continue

    const amount = parseAmount(cell(cells, COL.amount))
    const isCredit = normalize(cell(cells, COL.direction)).startsWith('CREDITO')

    if (!isCredit || amount <= 0 || IGNORED_MOVEMENTS.has(movement)) {
      discarded++
      continue
    }

    rows.push(mapRow(rows.length, cells, movement, amount, existingTickers))
  }

  return { rows, discarded }
}

/**
 * Segunda passada, separada porque depende do banco: quem já está gravado chega com
 * "Ignorar" marcado, em vez de virar provento em dobro num clique distraído.
 */
export function markAlreadyImported(
  rows: readonly DividendCsvRow[],
  existingKeys: ReadonlySet<string>,
): DividendCsvRow[] {
  return rows.map((row) => {
    if (row.error !== null) return row
    if (!existingKeys.has(dividendKey(row.ticker, row.date, row.type, row.totalAmount))) return row

    return {
      ...row,
      warning: row.warning === null ? ALREADY_IMPORTED : `${ALREADY_IMPORTED} · ${row.warning}`,
      skipByDefault: true,
    }
  })
}

function mapRow(
  rowIndex: number,
  cells: readonly string[],
  movement: string,
  amount: number,
  existingTickers: ReadonlySet<string>,
): DividendCsvRow {
  const errors: string[] = []
  const warnings: string[] = []

  const ticker = extractTicker(cell(cells, COL.product))
  if (ticker === null) errors.push(`Ticker não identificado: ${cell(cells, COL.product).trim()}`)
  else if (!existingTickers.has(ticker)) errors.push(`Ativo não cadastrado: ${ticker}`)

  const rawDate = cell(cells, COL.date).trim()
  const date = parseDate(rawDate)
  if (date === null) errors.push(`Data inválida: ${rawDate}`)

  const type = MOVEMENT_TO_TYPE[movement]
  let skipByDefault = false

  if (movement === 'REEMBOLSO') warnings.push(REEMBOLSO_WARNING)
  if (movement === 'RESTITUICAO DE CAPITAL') {
    warnings.push(RESTITUICAO_WARNING)
    skipByDefault = true
  } else if (type === undefined) {
    warnings.push(`Movimentação não reconhecida: ${cell(cells, COL.movement).trim()}`)
    skipByDefault = true
  }

  return {
    rowIndex,
    ticker: ticker ?? '',
    date: date ?? rawDate,
    type: type ?? 'DIVIDENDO',
    // O extrato traz o líquido creditado; o IR já veio descontado e não é discriminado.
    totalAmount: amount,
    taxWithheld: 0,
    currency: 'BRL',
    broker: extractBroker(cell(cells, COL.institution)),
    notes: 'CEI-Movimentação',
    error: errors.length > 0 ? errors.join('; ') : null,
    warning: warnings.length > 0 ? warnings.join(' · ') : null,
    skipByDefault,
  }
}

function assertHeader(header: readonly string[]): void {
  const found = EXPECTED_HEADER.every(
    (expected, index) => normalize(cell(header, index)) === expected,
  )
  if (!found) {
    throw new Error(
      'Planilha não parece o extrato de Movimentação da B3 — esperado o cabeçalho ' +
        '"Entrada/Saída · Data · Movimentação · Produto · Instituição · Quantidade · ' +
        'Preço unitário · Valor da Operação".',
    )
  }
}

/** `MDIA3 - M.DIAS BRANCO S.A.` → `MDIA3`. Produto sem código devolve null. */
function extractTicker(product: string): string | null {
  const code = (product.split(' - ')[0] ?? '').trim().toUpperCase()
  return /^[A-Z0-9]{4,6}$/.test(code) ? code : null
}

/** `XP INVESTIMENTOS CCTVM S/A.` → `XP`, que é como a corretora está gravada no histórico. */
function extractBroker(institution: string): string {
  return (institution.trim().split(/\s+/)[0] ?? '').toUpperCase()
}

/**
 * A B3 grava a data como texto `dd/MM/yyyy`. Serial do Excel é aceito porque a mesma tela
 * exporta com data numérica quando a planilha passa por um editor antes de chegar aqui.
 */
function parseDate(raw: string): string | null {
  const fromText = fromBrazilianDate(raw)
  if (fromText !== null) return fromText

  const serial = Number(raw)
  if (!Number.isFinite(serial) || serial < 1) return null
  // Época do Excel: o dia 1 é 01/01/1900, e o ano 1900 é tratado como bissexto — a base
  // 30/12/1899 absorve as duas coisas.
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10)
}

function cell(cells: readonly string[], index: number): string {
  return cells[index] ?? ''
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
}

/**
 * A planilha guarda número como `669.65` — ponto decimal, não separador de milhar. Passar
 * isso pelo `parseBrazilianNumber` daria 66965: cem vezes o provento, sem erro nenhum na
 * tela. Só cai no formato brasileiro quando a célula veio como texto (`1.234,56`).
 */
function parseAmount(raw: string): number {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-') return 0
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return parseBrazilianNumber(trimmed) ?? 0
}
