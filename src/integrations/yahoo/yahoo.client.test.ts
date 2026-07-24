import { describe, expect, it } from 'vitest'
import { server, yahooChart, yahooChartBySymbol, yahooError } from '../../../tests/msw.js'
import { isoDate } from '../../shared/iso-date.js'
import { YahooClient } from './yahoo.client.js'

// Porte de src/test/kotlin/com/stocks/service/QuoteServiceTest.kt (parte Yahoo),
// usando os mesmos fixtures da suíte Kotlin.

const client = () => new YahooClient()

describe('fetchQuotesBatch', () => {
  it('lista vazia devolve mapa vazio, sem chamar a API', async () => {
    expect((await client().fetchQuotesBatch([])).size).toBe(0)
  })

  it('devolve o preço de regularMarketPrice', async () => {
    server.use(yahooChart('yahoo_chart_petr3.json'))

    const result = await client().fetchQuotesBatch(['PETR3.SA'])
    expect(result.get('PETR3.SA')).toBeCloseTo(38.45, 2)
  })

  it('vários símbolos devolvem todos os preços', async () => {
    server.use(
      yahooChartBySymbol({
        'PETR3.SA': 'yahoo_chart_petr3.json',
        'BOVA11.SA': 'yahoo_chart_etf.json',
      }),
    )

    const result = await client().fetchQuotesBatch(['PETR3.SA', 'BOVA11.SA'])
    expect(result.size).toBe(2)
    expect(result.has('PETR3.SA')).toBe(true)
    expect(result.has('BOVA11.SA')).toBe(true)
  })

  it('preço zero é excluído', async () => {
    server.use(yahooChart('yahoo_chart_zero_price.json'))

    const result = await client().fetchQuotesBatch(['ZERO.SA'])
    expect(result.size).toBe(0)
  })

  it('erro da API devolve mapa vazio, sem lançar', async () => {
    server.use(yahooError(500))

    const result = await client().fetchQuotesBatch(['PETR3.SA'])
    expect(result.size).toBe(0)
  })

  it('segunda chamada usa o cache e não bate na rede', async () => {
    server.use(yahooChart('yahoo_chart_petr3.json'))

    let requests = 0
    const count = () => {
      requests++
    }
    server.events.on('request:start', count)

    const cached = client()
    await cached.fetchQuotesBatch(['PETR3.SA'])
    await cached.fetchQuotesBatch(['PETR3.SA'])

    server.events.removeListener('request:start', count)
    expect(requests).toBe(1)
  })

  it('cache expira depois do TTL de 4 horas', async () => {
    server.use(yahooChart('yahoo_chart_petr3.json'))

    let requests = 0
    const count = () => {
      requests++
    }
    server.events.on('request:start', count)

    let clock = 1_000_000
    const expiring = new YahooClient({ now: () => clock })
    await expiring.fetchQuotesBatch(['PETR3.SA'])
    clock += 4 * 3600 + 1
    await expiring.fetchQuotesBatch(['PETR3.SA'])

    server.events.removeListener('request:start', count)
    expect(requests).toBe(2)
  })
})

describe('fetchAssetInfo', () => {
  it('PETR3 devolve nome, STOCK, PETR3.SA e BRL', async () => {
    server.use(yahooChart('yahoo_chart_petr3.json'))

    const info = await client().fetchAssetInfo('PETR3')
    expect(info.name).toContain('Petrobras')
    expect(info.type).toBe('STOCK')
    expect(info.yfTicker).toBe('PETR3.SA')
    expect(info.currency).toBe('BRL')
  })

  it('instrumentType ETF devolve tipo ETF', async () => {
    server.use(yahooChart('yahoo_chart_etf.json'))

    const info = await client().fetchAssetInfo('BOVA11')
    expect(info.type).toBe('ETF')
  })

  it('FII brasileiro (termina em 11) devolve REIT', async () => {
    server.use(yahooChart('yahoo_chart_reit.json'))

    const info = await client().fetchAssetInfo('HGLG11')
    expect(info.type).toBe('REIT')
  })

  it('ticker desconhecido devolve fallback com o próprio ticker como nome', async () => {
    server.use(yahooChart('yahoo_chart_empty.json'))

    const info = await client().fetchAssetInfo('XXXX9')
    expect(info.name).toBe('XXXX9')
    expect(info.yfTicker).toBe('XXXX9.SA')
    expect(info.currency).toBe('BRL')
  })

  it('erro da API também cai no fallback', async () => {
    server.use(yahooError(503))

    const info = await client().fetchAssetInfo('PETR3')
    expect(info.name).toBe('PETR3')
    expect(info.type).toBe('STOCK')
  })

  it('moeda USD é preservada', async () => {
    server.use(yahooChart('yahoo_chart_usd_asset.json'))

    const info = await client().fetchAssetInfo('AAPL')
    expect(info.currency).toBe('USD')
  })

  it('moeda fora de BRL/USD cai para o padrão da classificação', async () => {
    server.use(yahooChart('yahoo_chart_eur_asset.json'))

    const info = await client().fetchAssetInfo('SAP.DE')
    // Ticker com ponto é INTERNATIONAL, cujo padrão é USD.
    expect(info.currency).toBe('USD')
  })

  it('tenta o segundo candidato quando o primeiro não responde', async () => {
    // AAPL classifica como ['AAPL', 'AAPL.SA']; só o segundo tem dado.
    server.use(yahooChartBySymbol({ 'AAPL.SA': 'yahoo_chart_usd_asset.json' }))

    const info = await client().fetchAssetInfo('AAPL')
    expect(info.yfTicker).toBe('AAPL.SA')
  })
})

describe('fetchHistoricalQuotesBatch', () => {
  it('mapa vazio devolve mapa vazio', async () => {
    const result = await client().fetchHistoricalQuotesBatch(new Map(), isoDate('2024-01-01'))
    expect(result.size).toBe(0)
  })

  it('devolve pares data-fechamento ordenados, pulando nulos e não positivos', async () => {
    server.use(yahooChart('yahoo_chart_historical.json'))

    const result = await client().fetchHistoricalQuotesBatch(
      new Map([['PETR3.SA', 'PETR3']]),
      isoDate('2024-01-01'),
    )

    const prices = result.get('PETR3')
    expect(prices).toBeDefined()
    expect(prices?.length).toBeGreaterThan(0)
    for (const [, close] of prices ?? []) expect(close).toBeGreaterThan(0)
    const dates = (prices ?? []).map(([d]) => d)
    expect(dates).toEqual([...dates].sort())
  })

  it('a chave do resultado é o ticker do ativo, não o símbolo do Yahoo', async () => {
    server.use(yahooChart('yahoo_chart_historical.json'))

    const result = await client().fetchHistoricalQuotesBatch(
      new Map([['PETR3.SA', 'PETR3']]),
      isoDate('2024-01-01'),
    )
    expect(result.has('PETR3')).toBe(true)
    expect(result.has('PETR3.SA')).toBe(false)
  })

  it('erro da API devolve mapa vazio', async () => {
    server.use(yahooError(500))

    const result = await client().fetchHistoricalQuotesBatch(
      new Map([['PETR3.SA', 'PETR3']]),
      isoDate('2024-01-01'),
    )
    expect(result.size).toBe(0)
  })

  it('resposta sem série não entra no resultado', async () => {
    server.use(yahooChart('yahoo_chart_empty.json'))

    const result = await client().fetchHistoricalQuotesBatch(
      new Map([['PETR3.SA', 'PETR3']]),
      isoDate('2024-01-01'),
    )
    expect(result.size).toBe(0)
  })
})
