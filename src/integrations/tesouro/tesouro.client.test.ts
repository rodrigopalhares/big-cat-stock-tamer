import { describe, expect, it } from 'vitest'
import { HttpResponse, http, server, TESOURO_CSV, tesouroCsv } from '../../../tests/msw.js'
import { TesouroClient } from './tesouro.client.js'

// Porte da parte de Tesouro Direto de src/test/kotlin/com/stocks/service/QuoteServiceTest.kt,
// com o mesmo fixture tesouro_direto_sample.csv.

const SELIC_2029 = 'Tesouro Selic;01/03/2029'
const client = () => new TesouroClient()

describe('fetchQuotesBatch', () => {
  it('lista vazia devolve mapa vazio, sem baixar o CSV', async () => {
    expect((await client().fetchQuotesBatch([])).size).toBe(0)
  })

  it('casa por título e vencimento, usando a data-base mais recente', async () => {
    server.use(tesouroCsv('tesouro_direto_sample.csv'))

    const result = await client().fetchQuotesBatch([SELIC_2029])
    // A data-base mais recente do fixture é 03/03/2024, com PU 14215,60.
    expect(result.get(SELIC_2029)).toBeCloseTo(14215.6, 2)
  })

  it('ticker que não é do Tesouro é ignorado', async () => {
    server.use(tesouroCsv('tesouro_direto_sample.csv'))

    expect((await client().fetchQuotesBatch(['PETR4'])).size).toBe(0)
  })

  it('título inexistente não entra no resultado', async () => {
    server.use(tesouroCsv('tesouro_direto_sample.csv'))

    expect((await client().fetchQuotesBatch(['Tesouro IPCA+;01/01/2099'])).size).toBe(0)
  })

  it('erro ao baixar devolve mapa vazio', async () => {
    server.use(http.get(TESOURO_CSV, () => new HttpResponse(null, { status: 500 })))

    expect((await client().fetchQuotesBatch([SELIC_2029])).size).toBe(0)
  })

  it('baixa o CSV uma única vez para várias consultas', async () => {
    server.use(tesouroCsv('tesouro_direto_sample.csv'))

    let requests = 0
    const count = () => {
      requests++
    }
    server.events.on('request:start', count)

    const cached = client()
    await cached.fetchQuotesBatch([SELIC_2029])
    await cached.fetchHistoricalQuotesBatch([SELIC_2029])

    server.events.removeListener('request:start', count)
    expect(requests).toBe(1)
  })
})

describe('fetchHistoricalQuotesBatch', () => {
  it('lista vazia devolve mapa vazio', async () => {
    expect((await client().fetchHistoricalQuotesBatch([])).size).toBe(0)
  })

  it('devolve a série ordenada por data', async () => {
    server.use(tesouroCsv('tesouro_direto_sample.csv'))

    const result = await client().fetchHistoricalQuotesBatch([SELIC_2029])
    const records = result.get(SELIC_2029)

    expect(records).toHaveLength(3)
    expect(records?.map(([, price]) => price)).toEqual([14205.32, 14210.45, 14215.6])

    const dates = records?.map(([date]) => date) ?? []
    expect(dates).toEqual([...dates].sort())
  })

  it('converte a data-base de dd/MM/yyyy para ISO', async () => {
    server.use(tesouroCsv('tesouro_direto_sample.csv'))

    const result = await client().fetchHistoricalQuotesBatch([SELIC_2029])
    expect(result.get(SELIC_2029)?.[0]?.[0]).toBe('2024-03-01')
  })

  it('erro ao baixar devolve mapa vazio', async () => {
    server.use(http.get(TESOURO_CSV, () => new HttpResponse(null, { status: 503 })))

    expect((await client().fetchHistoricalQuotesBatch([SELIC_2029])).size).toBe(0)
  })

  it('CSV vazio devolve mapa vazio', async () => {
    server.use(http.get(TESOURO_CSV, () => HttpResponse.text('')))

    expect((await client().fetchHistoricalQuotesBatch([SELIC_2029])).size).toBe(0)
  })
})

describe('código curto do ativo', () => {
  const shortCodes = () => server.use(tesouroCsv('tesouro_direto_short_codes.csv'))

  it('cota pelo código curto, com a chave que o chamador passou', async () => {
    shortCodes()

    const result = await client().fetchQuotesBatch(['TD:IPCA2026', 'TD:SELIC2027'])

    expect(result.get('TD:IPCA2026')).toBeCloseTo(4708.05, 2)
    expect(result.get('TD:SELIC2027')).toBeCloseTo(19548.33, 2)
  })

  it('IPCA sem sufixo não pega o preço do título com juros semestrais', async () => {
    shortCodes()

    const result = await client().fetchQuotesBatch(['TD:IPCA2026', 'TD:IPCAJ2026'])

    // Mesmo vencimento, PU diferente: confundir os dois erraria o valor da carteira.
    expect(result.get('TD:IPCA2026')).toBeCloseTo(4708.05, 2)
    expect(result.get('TD:IPCAJ2026')).toBeCloseTo(4847.23, 2)
  })

  it('título vencido não tem cotação de hoje, mas tem histórico', async () => {
    shortCodes()

    const td = client()
    expect((await td.fetchQuotesBatch(['TD:IPCA2019'])).size).toBe(0)

    const history = await td.fetchHistoricalQuotesBatch(['TD:IPCA2019'])
    expect(history.get('TD:IPCA2019')).toEqual([['2019-03-01', 3224.89]])
  })

  it('histórico pelo código curto usa a chave de entrada', async () => {
    shortCodes()

    const result = await client().fetchHistoricalQuotesBatch(['TD:IPCA2026'])
    expect(result.get('TD:IPCA2026')?.map(([, price]) => price)).toEqual([4700.1, 4708.05])
  })

  it('identifica o ativo para o cadastro', async () => {
    shortCodes()

    expect(await client().fetchAssetInfo('TD:IPCA2026')).toEqual({
      name: 'Tesouro IPCA+ 15/08/2026',
      type: 'TESOURO_DIRETO',
      yfTicker: 'Tesouro IPCA+;15/08/2026',
      currency: 'BRL',
      alternatives: [],
    })
  })

  it('avisa quando o ano tem mais de um vencimento', async () => {
    shortCodes()

    const info = await client().fetchAssetInfo('TD:PRE2009')

    expect(info?.yfTicker).toBe('Tesouro Prefixado;01/01/2009')
    expect(info?.alternatives).toEqual(['01/07/2009', '01/10/2009'])
  })

  it('código desconhecido não identifica ativo nenhum', async () => {
    shortCodes()

    expect(await client().fetchAssetInfo('TD:IPCA2099')).toBeNull()
    expect(await client().fetchAssetInfo('PETR4')).toBeNull()
  })

  it('erro ao baixar o CSV não identifica ativo', async () => {
    server.use(http.get(TESOURO_CSV, () => new HttpResponse(null, { status: 500 })))

    expect(await client().fetchAssetInfo('TD:IPCA2026')).toBeNull()
  })
})
