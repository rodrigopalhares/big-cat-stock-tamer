import { addDays, compareDates, daysBetween, type IsoDate } from '../shared/iso-date.js'
import { type AssetType, NO_QUOTE_TYPES } from './constants.js'
import { classifyTicker } from './ticker-classification.js'

/**
 * Funções puras do histórico de preços — resolução de símbolo, categorização de ativos
 * e filtragem dos lotes vindos da API.
 * Porte das funções top-level de src/main/kotlin/com/stocks/service/PriceHistoryService.kt.
 */

export type AssetTickerInfo = {
  readonly ticker: string
  readonly yfTicker: string | null
  readonly type: AssetType | string | null
  readonly delisted?: boolean
}

export type TickerMaps = {
  /** símbolo no Yahoo → ticker do ativo */
  readonly yfTickerMap: ReadonlyMap<string, string>
  /** código do Tesouro → ticker do ativo */
  readonly tdTickerMap: ReadonlyMap<string, string>
}

export type PriceRecord = {
  readonly assetId: string
  readonly date: IsoDate
  readonly close: number
}

export type DatedPrice = readonly [IsoDate, number]

/** Símbolo explícito quando existe; senão, o primeiro candidato da classificação. */
export function resolveYfTicker(ticker: string, yfTicker: string | null): string {
  return yfTicker ?? (classifyTicker(ticker).yfCandidates[0] as string)
}

/**
 * Separa os ativos entre os que têm cotação no Yahoo e os do Tesouro Direto.
 *
 * Ativos deslistados e tipos sem cotação (RENDA_FIXA, OUTROS) ficam de fora — buscar preço
 * deles é chamada perdida. Tesouro sem `yfTicker` também sai: não há como identificar o papel.
 */
export function categorizeAssets(assets: readonly AssetTickerInfo[]): TickerMaps {
  const yfTickerMap = new Map<string, string>()
  const tdTickerMap = new Map<string, string>()

  for (const asset of assets) {
    if (asset.delisted) continue
    if (asset.type !== null && NO_QUOTE_TYPES.has(asset.type as AssetType)) continue

    if (asset.type === 'TESOURO_DIRETO') {
      if (asset.yfTicker !== null) tdTickerMap.set(asset.yfTicker, asset.ticker)
    } else {
      yfTickerMap.set(resolveYfTicker(asset.ticker, asset.yfTicker), asset.ticker)
    }
  }

  return { yfTickerMap, tdTickerMap }
}

/**
 * Converte o resultado da API em registros prontos para gravar.
 *
 * [tickerResolver] traduz a chave do lote para o ticker do ativo (null descarta a série);
 * [datePredicate] decide, por ativo e data, se aquele preço deve entrar.
 */
export function filterBatchToRecords(
  batch: ReadonlyMap<string, readonly DatedPrice[]>,
  datePredicate: (assetTicker: string, date: IsoDate) => boolean,
  tickerResolver: (key: string) => string | null = (key) => key,
): PriceRecord[] {
  const records: PriceRecord[] = []
  for (const [key, prices] of batch) {
    const assetTicker = tickerResolver(key)
    if (assetTicker === null) continue
    for (const [date, close] of prices) {
      if (datePredicate(assetTicker, date)) records.push({ assetId: assetTicker, date, close })
    }
  }
  return records
}

/**
 * Série de preços diária para um ativo deslistado, que não tem mais cotação em lugar nenhum.
 * Porte da parte pura de `generateDelistedPrices` em PriceHistoryService.kt.
 *
 * Entre duas transações, interpola linearmente entre os preços praticados; a partir da
 * última, repete o preço até [today]. É uma aproximação declarada — sem mercado, não há
 * preço "certo", e sem série a carteira simplesmente não conseguiria montar o gráfico.
 */
export function interpolateDelistedPrices(
  assetTicker: string,
  transactionPrices: readonly DatedPrice[],
  today: IsoDate,
): PriceRecord[] {
  if (transactionPrices.length === 0) return []

  const sorted = [...transactionPrices].sort((a, b) => compareDates(a[0], b[0]))
  const records: PriceRecord[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const [dateA, priceA] = sorted[i] as DatedPrice
    const [dateB, priceB] = sorted[i + 1] as DatedPrice
    const totalDays = daysBetween(dateA, dateB)

    for (let date = dateA; date < dateB; date = addDays(date, 1)) {
      const dayOffset = daysBetween(dateA, date)
      const close = totalDays > 0 ? priceA + ((priceB - priceA) * dayOffset) / totalDays : priceA
      records.push({ assetId: assetTicker, date, close })
    }
  }

  const [lastDate, lastPrice] = sorted[sorted.length - 1] as DatedPrice
  for (let date = lastDate; date <= today; date = addDays(date, 1)) {
    records.push({ assetId: assetTicker, date, close: lastPrice })
  }

  return records
}
