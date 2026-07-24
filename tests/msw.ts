import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

/**
 * Interceptação de HTTP nos testes — substitui o MockRestServiceServer do Spring.
 * Os fixtures são os mesmos arquivos que a suíte Kotlin usa, copiados sem alteração.
 */

const FIXTURES = join(import.meta.dirname, 'fixtures')

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

/** Valor JSON — o que o HttpResponse.json aceita como corpo. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export function fixtureJson(name: string): Json {
  return JSON.parse(fixture(name)) as Json
}

export const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/:symbol'
export const BCB_PTAX = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/*'
export const BCB_SGS = 'https://api.bcb.gov.br/dados/serie/*'
export const TESOURO_CSV = 'https://www.tesourotransparente.gov.br/*'

export const server = setupServer()

/** Responde a qualquer símbolo do Yahoo com o mesmo fixture. */
export function yahooChart(name: string) {
  return http.get(YAHOO_CHART, () => HttpResponse.json(fixtureJson(name)))
}

/** Escolhe o fixture pelo símbolo pedido; símbolo não mapeado devolve 404. */
export function yahooChartBySymbol(bySymbol: Record<string, string>) {
  return http.get(YAHOO_CHART, ({ params }) => {
    const symbol = decodeURIComponent(String(params['symbol']))
    const name = bySymbol[symbol]
    return name === undefined
      ? new HttpResponse(null, { status: 404 })
      : HttpResponse.json(fixtureJson(name))
  })
}

export function yahooError(status = 500) {
  return http.get(YAHOO_CHART, () => new HttpResponse(null, { status }))
}

export function bcbPtax(name: string) {
  return http.get(BCB_PTAX, () => HttpResponse.json(fixtureJson(name)))
}

export function bcbSeries(body: Json) {
  return http.get(BCB_SGS, () => HttpResponse.json(body))
}

export function tesouroCsv(name: string) {
  return http.get(TESOURO_CSV, () =>
    HttpResponse.text(fixture(name), { headers: { 'Content-Type': 'text/csv' } }),
  )
}

export { HttpResponse, http }
