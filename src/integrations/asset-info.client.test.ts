import { describe, expect, it } from 'vitest'
import { server, tesouroCsv, yahooChart } from '../../tests/msw.js'
import { AssetInfoClient } from './asset-info.client.js'
import { TesouroClient } from './tesouro/tesouro.client.js'
import { YahooClient } from './yahoo/yahoo.client.js'

const client = () => new AssetInfoClient(new YahooClient(), new TesouroClient())

describe('fetchAssetInfo', () => {
  it('manda ticker comum para o Yahoo', async () => {
    server.use(yahooChart('yahoo_chart_petr3.json'))

    const info = await client().fetchAssetInfo('PETR3')

    expect(info.type).toBe('STOCK')
    expect(info.alternatives).toEqual([])
  })

  it('manda código do Tesouro para o CSV, sem passar pelo Yahoo', async () => {
    server.use(tesouroCsv('tesouro_direto_short_codes.csv'))

    // Sem handler do Yahoo registrado: se o roteamento errasse, a requisição falharia.
    const info = await client().fetchAssetInfo('TD:IPCA2026')

    expect(info).toEqual({
      name: 'Tesouro IPCA+ 15/08/2026',
      type: 'TESOURO_DIRETO',
      yfTicker: 'Tesouro IPCA+;15/08/2026',
      currency: 'BRL',
      alternatives: [],
    })
  })

  it('aceita também o código longo do CSV', async () => {
    server.use(tesouroCsv('tesouro_direto_short_codes.csv'))

    const info = await client().fetchAssetInfo('Tesouro Selic;01/03/2027')
    expect(info.name).toBe('Tesouro Selic 01/03/2027')
  })

  it('título inexistente vira "não encontrado", não vira consulta ao Yahoo', async () => {
    server.use(tesouroCsv('tesouro_direto_short_codes.csv'))

    const info = await client().fetchAssetInfo('TD:IPCA2099')

    // `name === ticker` é o contrato de não encontrado; o tipo continua sendo do Tesouro.
    expect(info.name).toBe('TD:IPCA2099')
    expect(info.type).toBe('TESOURO_DIRETO')
    expect(info.yfTicker).toBe('')
  })
})
