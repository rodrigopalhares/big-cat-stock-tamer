import type { AssetType, Currency } from '../../domain/constants.js'
import { classifyTicker, isBrazilianReit } from '../../domain/ticker-classification.js'
import { compareDates, type IsoDate } from '../../shared/iso-date.js'
import { BROWSER_USER_AGENT, HttpClient, type Logger, silentLogger } from '../http.js'
import { TtlCache } from '../ttl-cache.js'
import { parseYahooChart } from './yahoo.schema.js'

/**
 * Cliente do Yahoo Finance.
 * Porte da parte Yahoo de src/main/kotlin/com/stocks/service/QuoteService.kt,
 * que misturava Yahoo, Tesouro Direto e cache num arquivo de 384 linhas.
 */

const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'
const QUOTE_CACHE_TTL_SECONDS = 4 * 3600

export type AssetInfo = {
  readonly name: string
  readonly type: AssetType
  readonly yfTicker: string
  readonly currency: Currency
}

export type DatedPrice = readonly [IsoDate, number]

export type YahooClientOptions = {
  readonly http?: HttpClient
  readonly logger?: Logger
  readonly now?: () => number
}

export class YahooClient {
  private readonly http: HttpClient
  private readonly logger: Logger
  private readonly quoteCache: TtlCache<number>

  constructor(options: YahooClientOptions = {}) {
    this.logger = options.logger ?? silentLogger
    this.http =
      options.http ?? new HttpClient({ userAgent: BROWSER_USER_AGENT, logger: this.logger })
    this.quoteCache = new TtlCache<number>(QUOTE_CACHE_TTL_SECONDS, options.now)
  }

  /**
   * Nome, tipo e moeda do ativo, tentando os candidatos da classificação em ordem.
   * Quando nenhum responde, devolve um fallback com o próprio ticker como nome —
   * é assim que o chamador detecta "não encontrado".
   */
  async fetchAssetInfo(ticker: string): Promise<AssetInfo> {
    const classification = classifyTicker(ticker)
    const candidates = classification.yfCandidates

    for (const yfTicker of candidates) {
      const result = await this.fetchChart(yfTicker, { range: '1d', interval: '1d' })
      const meta = result?.meta
      if (!meta) continue

      const name = meta.longName ?? meta.shortName
      if (!name) continue

      const quoteType = (meta.instrumentType ?? '').toUpperCase()
      const symbol = meta.symbol ?? yfTicker

      const type: AssetType =
        quoteType === 'ETF'
          ? 'ETF'
          : quoteType === 'EQUITY' && isBrazilianReit(symbol, name)
            ? 'REIT'
            : (classification.suggestedType ?? 'STOCK')

      const rawCurrency = (meta.currency ?? classification.defaultCurrency).toUpperCase()
      const currency: Currency =
        rawCurrency === 'BRL' || rawCurrency === 'USD'
          ? rawCurrency
          : classification.defaultCurrency

      return { name, type, yfTicker, currency }
    }

    return {
      name: ticker,
      type: classification.suggestedType ?? 'STOCK',
      yfTicker: candidates[0] as string,
      currency: classification.defaultCurrency,
    }
  }

  /** Cotação atual de vários símbolos. Consulta só o que não está em cache. */
  async fetchQuotesBatch(yfTickers: readonly string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>()
    if (yfTickers.length === 0) return results

    const toFetch: string[] = []
    for (const ticker of yfTickers) {
      const cached = this.quoteCache.get(ticker)
      if (cached !== null) results.set(ticker, cached)
      else toFetch.push(ticker)
    }

    for (const ticker of toFetch) {
      const result = await this.fetchChart(ticker, { range: '1d', interval: '1d' })
      const price = result?.meta?.regularMarketPrice
      if (typeof price === 'number' && price > 0) {
        this.quoteCache.set(ticker, price)
        results.set(ticker, price)
      }
    }
    return results
  }

  /**
   * Série histórica de vários ativos, a partir de [startDate].
   * A chave do resultado é o ticker do *ativo*, não o símbolo do Yahoo.
   */
  async fetchHistoricalQuotesBatch(
    yfTickerMap: ReadonlyMap<string, string>,
    startDate: IsoDate,
  ): Promise<Map<string, DatedPrice[]>> {
    const results = new Map<string, DatedPrice[]>()
    if (yfTickerMap.size === 0) return results

    for (const [yfTicker, assetTicker] of yfTickerMap) {
      const prices = await this.fetchHistorical(yfTicker, startDate)
      if (prices.length > 0) results.set(assetTicker, prices)
    }
    return results
  }

  private async fetchHistorical(yfTicker: string, startDate: IsoDate): Promise<DatedPrice[]> {
    const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000)
    const period2 = Math.floor(Date.now() / 1000)
    const result = await this.fetchChart(yfTicker, { period1, period2, interval: '1d' })

    const timestamps = result?.timestamp
    const closes = result?.indicators?.quote?.[0]?.close
    if (!timestamps || !closes) return []

    const records: DatedPrice[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i]
      if (close === null || close === undefined || close <= 0) continue
      const timestamp = timestamps[i] as number
      // Divisão inteira por 86400, como o LocalDate.ofEpochDay do Kotlin.
      const date = new Date(Math.floor(timestamp / 86400) * 86_400_000)
        .toISOString()
        .slice(0, 10) as IsoDate
      records.push([date, close])
    }
    return records.sort((a, b) => compareDates(a[0], b[0]))
  }

  private async fetchChart(
    yfTicker: string,
    params: Record<string, string | number>,
  ): Promise<import('./yahoo.schema.js').YahooChartResult | null> {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString()
    const url = `${BASE_URL}/${encodeURIComponent(yfTicker)}?${query}`

    const raw = await this.http.getJson(url)
    if (raw === null) return null

    const parsed = parseYahooChart(raw)
    if (parsed === null) {
      this.logger.warn(`Resposta do Yahoo em formato inesperado para ${yfTicker}`)
      return null
    }
    return parsed.chart?.result?.[0] ?? null
  }
}
