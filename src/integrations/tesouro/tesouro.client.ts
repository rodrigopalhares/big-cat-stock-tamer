import {
  latestRows,
  parseTesouroCsv,
  rowsForTicker,
  type TesouroRow,
} from '../../domain/csv/tesouro-csv.js'
import { compareDates, type IsoDate } from '../../shared/iso-date.js'
import { HttpClient, type Logger, silentLogger } from '../http.js'
import { TtlCache } from '../ttl-cache.js'

/**
 * Cliente do Tesouro Transparente.
 * Porte da parte de Tesouro Direto de src/main/kotlin/com/stocks/service/QuoteService.kt.
 *
 * A API publica um CSV único com o histórico completo de todos os títulos. Baixar isso a
 * cada cotação seria absurdo, então o arquivo inteiro fica em cache por 4 horas e as
 * consultas filtram em memória — mesma estratégia do original.
 */

const CSV_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/' +
  'df56aa42-484a-4a59-8184-7676580c81e3/resource/' +
  '796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv'

const CSV_CACHE_TTL_SECONDS = 4 * 3600
const CACHE_KEY = 'full-csv'

export type DatedPrice = readonly [IsoDate, number]

export class TesouroClient {
  private readonly http: HttpClient
  private readonly logger: Logger
  private readonly csvCache: TtlCache<TesouroRow[]>

  constructor(options: { http?: HttpClient; logger?: Logger; now?: () => number } = {}) {
    this.logger = options.logger ?? silentLogger
    this.http = options.http ?? new HttpClient({ logger: this.logger })
    this.csvCache = new TtlCache<TesouroRow[]>(CSV_CACHE_TTL_SECONDS, options.now)
  }

  /** Preço atual de cada título, pela data-base mais recente do arquivo. */
  async fetchQuotesBatch(tickers: readonly string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>()
    if (tickers.length === 0) return results

    const rows = await this.fetchCsv()
    if (rows.length === 0) return results

    const latest = latestRows(rows)
    for (const ticker of tickers) {
      const price = rowsForTicker(latest, ticker)[0]?.puCompraManha
      if (price !== null && price !== undefined && price > 0) results.set(ticker, price)
      else if (!ticker.includes(';')) this.logger.warn(`Ticker do Tesouro inválido: ${ticker}`)
    }
    return results
  }

  /** Série histórica de cada título, ordenada por data. */
  async fetchHistoricalQuotesBatch(tickers: readonly string[]): Promise<Map<string, DatedPrice[]>> {
    const results = new Map<string, DatedPrice[]>()
    if (tickers.length === 0) return results

    const rows = await this.fetchCsv()
    if (rows.length === 0) return results

    for (const ticker of tickers) {
      if (!ticker.includes(';')) {
        this.logger.warn(`Ticker do Tesouro inválido: ${ticker}`)
        continue
      }
      const records = rowsForTicker(rows, ticker)
        .filter(
          (r): r is TesouroRow & { dataBase: IsoDate; puCompraManha: number } =>
            r.dataBase !== null && r.puCompraManha !== null && r.puCompraManha > 0,
        )
        .map((r): DatedPrice => [r.dataBase, r.puCompraManha])
        .sort((a, b) => compareDates(a[0], b[0]))

      if (records.length > 0) results.set(ticker, records)
    }
    return results
  }

  private async fetchCsv(): Promise<TesouroRow[]> {
    const cached = this.csvCache.get(CACHE_KEY)
    if (cached !== null) return cached

    const text = await this.http.getText(CSV_URL)
    if (text === null) return []

    const rows = parseTesouroCsv(text)
    this.csvCache.set(CACHE_KEY, rows)
    return rows
  }
}
