import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../tests/msw.js'
import { AnthropicClient } from './anthropic.client.js'

/** Leitura da nota pela Anthropic, com a API interceptada. */

const MESSAGES = 'https://api.anthropic.com/v1/messages'

const EXTRACTION = {
  tradeDate: '2026-07-15',
  broker: 'XP',
  noteNumber: '140232205',
  trades: [
    { ticker: 'XPLG11', side: 'C', quantity: 100, price: 91.67 },
    { ticker: 'xplg11 ', side: 'C', quantity: 229, price: 91.63 },
  ],
  fees: [{ label: 'Taxa de liquidação', value: 6.75 }],
  totalFees: 9.03,
  totalAmount: 30160.98,
  checkedTotal: 30160.98,
  checkNotes: 'Confere.',
}

/** Resposta da Messages API com o JSON da saída estruturada no bloco de texto. */
function reply(body: unknown, stopReason = 'end_turn') {
  return HttpResponse.json({
    id: 'msg_teste',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 7378, output_tokens: 790 },
  })
}

const pdf = Buffer.from('%PDF-1.4 nota')

// O SDK guarda a referência do `fetch` na construção: criar o cliente aqui, no corpo do
// teste, garante que ele pegue o `fetch` já trocado pelo MSW — construído no topo do
// arquivo, ele seguraria o original e as requisições sairiam para a internet de verdade.
const client = () => new AnthropicClient({ apiKey: 'sk-teste', maxRetries: 0 })
const extract = () => client().extractBrokerNote(pdf, 'application/pdf')

describe('AnthropicClient', () => {
  it('converte a extração para os dados da nota', async () => {
    server.use(http.post(MESSAGES, () => reply(EXTRACTION)))

    const result = await extract()

    expect(result.note).toMatchObject({
      date: '2026-07-15',
      broker: 'XP',
      noteNumber: '140232205',
      totalFees: 9.03,
      totalAmount: 30160.98,
    })
    expect(result.note.trades).toHaveLength(2)
    // Ticker normalizado já na fronteira, não lá no domínio.
    expect(result.note.trades[1]?.ticker).toBe('XPLG11')
    expect(result.checkNotes).toBe('Confere.')
    expect(result.fees[0]).toEqual({ label: 'Taxa de liquidação', value: 6.75 })
  })

  it('envia o PDF como documento base64 junto do schema de saída', async () => {
    let sent: Record<string, unknown> = {}
    server.use(
      http.post(MESSAGES, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>
        return reply(EXTRACTION)
      }),
    )

    await extract()

    expect(sent['model']).toBe('claude-haiku-4-5')
    const content = (sent['messages'] as Array<{ content: Array<Record<string, unknown>> }>)[0]
      ?.content
    expect(content?.[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
    })
    expect(sent['output_config']).toMatchObject({ format: { type: 'json_schema' } })
  })

  it('aceita imagem de nota escaneada', async () => {
    let mediaType = ''
    server.use(
      http.post(MESSAGES, async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ content: Array<{ source?: { media_type?: string } }> }>
        }
        mediaType = body.messages[0]?.content[0]?.source?.media_type ?? ''
        return reply(EXTRACTION)
      }),
    )

    await client().extractBrokerNote(pdf, 'image/png')

    expect(mediaType).toBe('image/png')
  })

  it('descarta o subtotal do resumo financeiro e recalcula as taxas', async () => {
    // Caso real da nota 139054003: o modelo devolveu "Total Bovespa / Soma 2,14", que é a
    // soma de emolumentos + transferência, e um totalFees de 10,63 contando tudo duas vezes.
    server.use(
      http.post(MESSAGES, () =>
        reply({
          ...EXTRACTION,
          fees: [
            { label: 'Taxa de liquidação', value: 6.35 },
            { label: 'Emolumentos', value: 1.41 },
            { label: 'Taxa de Transf. de Ativos', value: 0.73 },
            { label: 'Total Bovespa / Soma', value: 2.14 },
          ],
          totalFees: 10.63,
        }),
      ),
    )

    const result = await extract()

    expect(result.note.totalFees).toBe(8.49)
    expect(result.fees.map((f) => f.label)).not.toContain('Total Bovespa / Soma')
  })

  it('mantém o total do modelo quando ele não discriminou as taxas', async () => {
    server.use(http.post(MESSAGES, () => reply({ ...EXTRACTION, fees: [], totalFees: 9.03 })))

    expect((await extract()).note.totalFees).toBe(9.03)
  })

  it('recusa tipo de arquivo que o modelo não lê', async () => {
    await expect(client().extractBrokerNote(pdf, 'application/zip')).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('recusa resposta fora do schema', async () => {
    server.use(http.post(MESSAGES, () => reply({ tradeDate: '2026-07-15' })))

    await expect(extract()).rejects.toMatchObject({ statusCode: 502 })
  })

  it('recusa resposta que não é JSON', async () => {
    server.use(http.post(MESSAGES, () => reply('desculpe, não consegui ler')))

    await expect(extract()).rejects.toMatchObject({ statusCode: 502 })
  })

  it('recusa data de pregão inválida', async () => {
    server.use(http.post(MESSAGES, () => reply({ ...EXTRACTION, tradeDate: '15/07/2026' })))

    await expect(extract()).rejects.toMatchObject({ statusCode: 502 })
  })

  it('recusa nota sem nenhuma operação', async () => {
    server.use(http.post(MESSAGES, () => reply({ ...EXTRACTION, trades: [] })))

    await expect(extract()).rejects.toMatchObject({ statusCode: 400 })
  })

  it('avisa quando a resposta foi cortada por tamanho', async () => {
    server.use(http.post(MESSAGES, () => reply(EXTRACTION, 'max_tokens')))

    await expect(extract()).rejects.toThrow(/longa demais/)
  })

  it('traduz erro da API em falha de gateway', async () => {
    server.use(
      http.post(MESSAGES, () =>
        HttpResponse.json({ error: { message: 'overloaded' } }, { status: 529 }),
      ),
    )

    await expect(extract()).rejects.toMatchObject({ statusCode: 502 })
  }, 20_000)

  it('fica desabilitado sem chave configurada', async () => {
    const disabled = new AnthropicClient({ apiKey: '' })

    expect(disabled.enabled).toBe(false)
    await expect(disabled.extractBrokerNote(pdf, 'application/pdf')).rejects.toThrow(
      /APP_ANTHROPIC_API_KEY/,
    )
  })
})
