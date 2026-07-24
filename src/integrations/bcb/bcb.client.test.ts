import { describe, expect, it } from 'vitest'
import {
  BCB_PTAX,
  BCB_SGS,
  bcbPtax,
  bcbSeries,
  HttpResponse,
  http,
  server,
} from '../../../tests/msw.js'
import { isoDate } from '../../shared/iso-date.js'
import { BcbClient } from './bcb.client.js'

// Porte de BcbPtaxClient.kt e de `fetchCdiAnnualRate` de BenchmarkService.kt,
// exercitados pelo ExchangeRateServiceTest e pelo fixture bcb_ptax_period.json.

const client = () => new BcbClient()

describe('fetchPtaxRange', () => {
  it('devolve cotações de compra e venda com a data extraída', async () => {
    server.use(bcbPtax('bcb_ptax_period.json'))

    const quotes = await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))

    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes[0]).toEqual({ date: '2025-03-05', buyRate: 5.7908, sellRate: 5.7914 })
  })

  it('descarta a hora do campo dataHoraCotacao', async () => {
    server.use(bcbPtax('bcb_ptax_period.json'))

    const quotes = await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))
    for (const quote of quotes) expect(quote.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('formata a data como MM-dd-yyyy na URL, como o PTAX exige', async () => {
    let requestUrl = ''
    server.use(
      http.get(BCB_PTAX, ({ request }) => {
        requestUrl = decodeURIComponent(request.url)
        return HttpResponse.json({ value: [] })
      }),
    )

    await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-12-31'))

    expect(requestUrl).toContain("@dataInicial='03-05-2025'")
    expect(requestUrl).toContain("@dataFinalCotacao='12-31-2025'")
  })

  it('erro da API devolve lista vazia', async () => {
    server.use(http.get(BCB_PTAX, () => new HttpResponse(null, { status: 500 })))

    expect(await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))).toEqual([])
  })

  it('resposta sem value devolve lista vazia', async () => {
    server.use(http.get(BCB_PTAX, () => HttpResponse.json({})))

    expect(await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))).toEqual([])
  })

  it('cotação com data inválida é descartada, sem derrubar as demais', async () => {
    server.use(
      http.get(BCB_PTAX, () =>
        HttpResponse.json({
          value: [
            { cotacaoCompra: 5.0, cotacaoVenda: 5.1, dataHoraCotacao: 'lixo' },
            { cotacaoCompra: 5.2, cotacaoVenda: 5.3, dataHoraCotacao: '2025-03-06 13:11:00.814' },
          ],
        }),
      ),
    )

    const quotes = await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))
    expect(quotes).toEqual([{ date: '2025-03-06', buyRate: 5.2, sellRate: 5.3 }])
  })
})

describe('fetchCdiAnnualRate', () => {
  it('converte percentual com vírgula em fração', async () => {
    server.use(bcbSeries([{ data: '01/03/2025', valor: '14,25' }]))

    expect(await client().fetchCdiAnnualRate()).toBeCloseTo(0.1425, 6)
  })

  it('aceita percentual com ponto', async () => {
    server.use(bcbSeries([{ data: '01/03/2025', valor: '10.5' }]))

    expect(await client().fetchCdiAnnualRate()).toBeCloseTo(0.105, 6)
  })

  it('série vazia devolve null', async () => {
    server.use(bcbSeries([]))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })

  it('valor não numérico devolve null', async () => {
    server.use(bcbSeries([{ data: '01/03/2025', valor: 'abc' }]))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })

  it('erro da API devolve null', async () => {
    server.use(http.get(BCB_SGS, () => new HttpResponse(null, { status: 502 })))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })

  it('resposta em formato inesperado devolve null', async () => {
    server.use(http.get(BCB_SGS, () => HttpResponse.json({ erro: 'nao é array' })))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })
})
