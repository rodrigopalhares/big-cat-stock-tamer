import type { Db } from '../../config/db.js'
import type { TransactionData } from '../../domain/calculation.js'
import { computePositionAtDate, generateMonthRange } from '../../domain/evolution.js'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'
import {
  firstDayOf,
  type IsoDate,
  lastDayOf,
  today as todayIso,
  type YearMonth,
  yearMonth,
} from '../../shared/iso-date.js'
import type { AssetService } from '../asset/asset.service.js'
import { toTransactionData } from '../asset/asset.service.js'
import type { PriceHistoryService } from '../price-history/price-history.service.js'
import type {
  MonthlyEvolutionRow,
  MonthlyEvolutionSummary,
  MonthlySnapshotView,
} from './evolution.schema.js'

/** Porte de src/main/kotlin/com/stocks/service/MonthlyEvolutionService.kt. */

type DividendFlow = { date: IsoDate; value: number }

export class EvolutionService {
  constructor(
    private readonly db: Db,
    private readonly priceHistory: PriceHistoryService,
    private readonly assets: AssetService,
    private readonly logger: Logger = silentLogger,
  ) {}

  /**
   * Refaz todos os snapshots mensais do zero.
   *
   * Reconstruir é mais simples e mais seguro que atualizar incrementalmente: preço histórico
   * pode ser corrigido, transação pode ser editada com data retroativa, e nesses casos um
   * snapshot antigo ficaria errado sem ninguém perceber.
   */
  async recalculate(today: IsoDate = todayIso()): Promise<void> {
    await this.priceHistory.runBackfill(today)
    await this.db.monthlySnapshot.deleteMany()

    const firstMonth = await this.findFirstTransactionMonth()
    if (firstMonth === null) return

    const months = generateMonthRange(firstMonth, yearMonth(today))

    const [assets, transactions, dividends, prices] = await Promise.all([
      this.db.asset.findMany({ select: { ticker: true, currency: true } }),
      this.db.transaction.findMany(),
      this.db.dividend.findMany({
        select: { assetId: true, date: true, totalAmountBrl: true, taxWithheldBrl: true },
      }),
      this.db.priceHistory.findMany({ select: { assetId: true, date: true, close: true } }),
    ])

    const currencies = new Map(assets.map((a) => [a.ticker, a.currency]))
    const txByAsset = groupBy(transactions, (t) => t.assetId)
    const dividendsByAsset = groupBy(dividends, (d) => d.assetId)
    const pricesByAsset = groupBy(prices, (p) => p.assetId)

    const records: Array<Omit<MonthlySnapshotView, 'month'> & { month: string }> = []

    for (const [ticker, txs] of txByAsset) {
      const data: TransactionData[] = txs.map(toTransactionData)
      const assetDividends: DividendFlow[] = (dividendsByAsset.get(ticker) ?? []).map((d) => ({
        date: d.date as IsoDate,
        value: d.totalAmountBrl - d.taxWithheldBrl,
      }))
      const assetPrices = (pricesByAsset.get(ticker) ?? []).map(
        (p) => [p.date as IsoDate, p.close] as const,
      )

      for (const month of months) {
        const monthEnd = lastDayOf(month)
        const position = computePositionAtDate(data, monthEnd)
        if (position.quantity <= 0) continue

        const marketPrice = latestPriceUpTo(assetPrices, monthEnd)
        if (marketPrice === null) continue

        const accumulatedNetDividends = assetDividends
          .filter((d) => d.date <= monthEnd)
          .reduce((total, d) => total + d.value, 0)

        // A cotação do fim do mês entra no valor de mercado de ativo em moeda estrangeira.
        const currency = currencies.get(ticker) ?? 'BRL'
        const rate = currency === 'BRL' ? 1 : await this.monthEndRate(currency, monthEnd)

        records.push({
          assetId: ticker,
          month: firstDayOf(month),
          quantity: position.quantity,
          avgPrice: position.avgPrice,
          marketPrice,
          totalCost: position.totalCostBrl,
          marketValue: position.quantity * marketPrice * rate,
          accumulatedNetDividends,
        })
      }
    }

    if (records.length > 0) {
      await this.db.monthlySnapshot.createMany({ data: records })
    }
    await this.assets.refreshAllPositionFields()

    this.logger.info(`Recalculados ${records.length} snapshots mensais`)
  }

  /** Evolução mês a mês, com os meses sem posição preenchidos com zero. */
  async getEvolution(): Promise<MonthlyEvolutionSummary> {
    const snapshots = await this.db.monthlySnapshot.findMany({ orderBy: { month: 'asc' } })
    if (snapshots.length === 0) return { months: [], tickers: [] }

    const dividends = await this.db.dividend.findMany({
      select: { date: true, totalAmountBrl: true, taxWithheldBrl: true },
    })
    const allDividends: DividendFlow[] = dividends.map((d) => ({
      date: d.date as IsoDate,
      value: d.totalAmountBrl - d.taxWithheldBrl,
    }))

    const tickers = [...new Set(snapshots.map((s) => s.assetId))].sort()
    const byMonth = groupBy(snapshots, (s) => s.month)

    const first = snapshots[0] as (typeof snapshots)[number]
    const last = snapshots[snapshots.length - 1] as (typeof snapshots)[number]
    const allMonths = generateMonthRange(
      yearMonth(first.month as IsoDate),
      yearMonth(last.month as IsoDate),
    )

    const months: MonthlyEvolutionRow[] = allMonths.map((ym) => {
      const monthStart = firstDayOf(ym)
      const monthEnd = lastDayOf(ym)

      const totalAccumulatedNetDividends = allDividends
        .filter((d) => d.date <= monthEnd)
        .reduce((total, d) => total + d.value, 0)
      const totalMonthlyNetDividends = allDividends
        .filter((d) => d.date >= monthStart && d.date <= monthEnd)
        .reduce((total, d) => total + d.value, 0)

      const monthSnapshots = (byMonth.get(monthStart) ?? []).map(
        (s): MonthlySnapshotView => ({
          assetId: s.assetId,
          month: s.month as IsoDate,
          quantity: s.quantity,
          avgPrice: s.avgPrice,
          marketPrice: s.marketPrice,
          totalCost: s.totalCost,
          marketValue: s.marketValue,
          accumulatedNetDividends: s.accumulatedNetDividends,
        }),
      )

      return {
        month: monthStart,
        snapshots: monthSnapshots,
        totalInvested: monthSnapshots.reduce((total, s) => total + s.totalCost, 0),
        totalMarketValue: monthSnapshots.reduce((total, s) => total + s.marketValue, 0),
        totalMonthlyNetDividends,
        totalAccumulatedNetDividends,
      }
    })

    return { months, tickers }
  }

  async findFirstTransactionMonth(): Promise<YearMonth | null> {
    const row = await this.db.transaction.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true },
    })
    return row === null ? null : yearMonth(row.date as IsoDate)
  }

  private async monthEndRate(currency: string, monthEnd: IsoDate): Promise<number> {
    const row = await this.db.exchangeRate.findFirst({
      where: { fromCurrency: currency, toCurrency: 'BRL', date: { lte: monthEnd } },
      orderBy: { date: 'desc' },
      select: { sellRate: true },
    })
    return row?.sellRate ?? 1
  }
}

function latestPriceUpTo(
  prices: readonly (readonly [IsoDate, number])[],
  monthEnd: IsoDate,
): number | null {
  let best: readonly [IsoDate, number] | null = null
  for (const entry of prices) {
    if (entry[0] > monthEnd) continue
    if (best === null || entry[0] > best[0]) best = entry
  }
  return best?.[1] ?? null
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list === undefined) map.set(k, [item])
    else list.push(item)
  }
  return map
}
