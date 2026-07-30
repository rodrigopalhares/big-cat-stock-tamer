import {
  latestRows,
  parseTesouroCsv,
  rowsForTicker,
  type TesouroRow,
} from '../../domain/csv/tesouro-csv.js'
import {
  resolveTesouroCode,
  type TesouroResolution,
  tesouroAssetName,
} from '../../domain/tesouro-ticker.js'
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
 *
 * Os métodos aceitam tanto o código do CSV (`Tesouro IPCA+;15/08/2026`) quanto o código
 * curto do ativo (`TD:IPCA2026`) — o mesmo arquivo em cache que dá a cotação é o que
 * traduz um no outro, então não custa uma requisição a mais.
 */

const CSV_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/' +
  'df56aa42-484a-4a59-8184-7676580c81e3/resource/' +
  '796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv'

const CSV_CACHE_TTL_SECONDS = 4 * 3600
const CACHE_KEY = 'full-csv'

export type DatedPrice = readonly [IsoDate, number]

/** O que o cadastro de ativo precisa saber sobre um título. Espelha o `AssetInfo` do Yahoo. */
export type TesouroAssetInfo = {
  readonly name: string
  readonly type: 'TESOURO_DIRETO'
  /** Código do CSV — é ele que vai para a coluna `yfTicker` e volta na hora da cotação. */
  readonly yfTicker: string
  readonly currency: 'BRL'
  /** Vencimentos alternativos quando o ano não identifica o papel sozinho. */
  readonly alternatives: readonly string[]
}

export class TesouroClient {
  private readonly http: HttpClient
  private readonly logger: Logger
  private readonly csvCache: TtlCache<TesouroRow[]>

  constructor(options: { http?: HttpClient; logger?: Logger; now?: () => number } = {}) {
    this.logger = options.logger ?? silentLogger
    this.http = options.http ?? new HttpClient({ logger: this.logger })
    this.csvCache = new TtlCache<TesouroRow[]>(CSV_CACHE_TTL_SECONDS, options.now)
  }

  /**
   * Identifica o título a partir do ticker, para preencher o cadastro do ativo.
   * Null quando o código não corresponde a nenhum papel do arquivo.
   */
  async fetchAssetInfo(ticker: string): Promise<TesouroAssetInfo | null> {
    const rows = await this.fetchCsv()
    if (rows.length === 0) return null

    const resolved = resolveTesouroCode(rows, ticker)
    if (resolved === null) {
      this.logger.warn(`Ticker do Tesouro inválido: ${ticker}`)
      return null
    }

    return {
      name: tesouroAssetName(resolved.title, resolved.maturity),
      type: 'TESOURO_DIRETO',
      yfTicker: resolved.code,
      currency: 'BRL',
      alternatives: resolved.alternatives,
    }
  }

  /** Preço atual de cada título, pela data-base mais recente do arquivo. */
  async fetchQuotesBatch(tickers: readonly string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>()
    if (tickers.length === 0) return results

    const rows = await this.fetchCsv()
    if (rows.length === 0) return results

    const latest = latestRows(rows)
    for (const ticker of tickers) {
      const resolved = this.resolve(rows, ticker)
      if (resolved === null) continue

      // Título vencido não aparece na data-base mais recente. Não é erro de digitação,
      // então sai calado — quem avisa é o `resolve`, que não achou o papel em lugar nenhum.
      const price = rowsForTicker(latest, resolved.code)[0]?.puCompraManha
      if (price !== null && price !== undefined && price > 0) results.set(ticker, price)
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
      const resolved = this.resolve(rows, ticker)
      if (resolved === null) continue

      const records = rowsForTicker(rows, resolved.code)
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

  /** Traduz o ticker para o código do CSV, avisando uma vez quando não reconhece. */
  private resolve(rows: readonly TesouroRow[], ticker: string): TesouroResolution | null {
    const resolved = resolveTesouroCode(rows, ticker)
    if (resolved === null) this.logger.warn(`Ticker do Tesouro inválido: ${ticker}`)
    return resolved
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
