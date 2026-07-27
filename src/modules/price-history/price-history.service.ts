import type { Db } from '../../config/db.js'
import {
  type AssetTickerInfo,
  categorizeAssets,
  type DatedPrice,
  filterBatchToRecords,
  interpolateDelistedPrices,
  type PriceRecord,
} from '../../domain/price-history.js'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'
import type { TesouroClient } from '../../integrations/tesouro/tesouro.client.js'
import type { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { addDays, type IsoDate, minDate, today as todayIso } from '../../shared/iso-date.js'

/** Porte de src/main/kotlin/com/stocks/service/PriceHistoryService.kt. */

const LOOKBACK_YEARS = 5

export class PriceHistoryService {
  constructor(
    private readonly db: Db,
    private readonly yahoo: YahooClient,
    private readonly tesouro: TesouroClient,
    private readonly logger: Logger = silentLogger,
  ) {}

  async getLatestPrice(assetTicker: string): Promise<number | null> {
    const row = await this.db.priceHistory.findFirst({
      where: { assetId: assetTicker },
      orderBy: { date: 'desc' },
      select: { close: true },
    })
    return row?.close ?? null
  }

  async getPricesForDate(
    assetTickers: readonly string[],
    date: IsoDate,
  ): Promise<Map<string, number>> {
    const rows = await this.db.priceHistory.findMany({
      where: { assetId: { in: [...assetTickers] }, date },
      select: { assetId: true, close: true },
    })
    return new Map(rows.map((r) => [r.assetId, r.close]))
  }

  async getLastStoredDate(assetTicker: string): Promise<IsoDate | null> {
    const row = await this.db.priceHistory.findFirst({
      where: { assetId: assetTicker },
      orderBy: { date: 'desc' },
      select: { date: true },
    })
    return (row?.date as IsoDate | undefined) ?? null
  }

  async getFirstStoredDate(assetTicker: string): Promise<IsoDate | null> {
    const row = await this.db.priceHistory.findFirst({
      where: { assetId: assetTicker },
      orderBy: { date: 'asc' },
      select: { date: true },
    })
    return (row?.date as IsoDate | undefined) ?? null
  }

  /** Grava os preços, sobrescrevendo o que já existir na mesma data. */
  async upsertPrices(records: readonly PriceRecord[]): Promise<void> {
    if (records.length === 0) return
    await this.db.$transaction(
      records.map((record) =>
        this.db.priceHistory.upsert({
          where: { assetId_date: { assetId: record.assetId, date: record.date } },
          create: record,
          update: { close: record.close },
        }),
      ),
    )
  }

  /** Preenche a série de um ativo deslistado a partir dos preços das próprias transações. */
  async generateDelistedPrices(assetTicker: string, today: IsoDate = todayIso()): Promise<void> {
    const transactions = await this.db.transaction.findMany({
      where: { assetId: assetTicker },
      orderBy: { date: 'asc' },
      select: { date: true, price: true },
    })
    if (transactions.length === 0) return

    const prices = transactions.map((t): DatedPrice => [t.date as IsoDate, t.price])
    const records = interpolateDelistedPrices(assetTicker, prices, today)

    await this.upsertPrices(records)
    this.logger.info(`Gerados ${records.length} preços de ${assetTicker} (deslistado)`)
  }

  /** Busca o histórico completo de cada ativo, a partir da última data já gravada. */
  async runBackfill(today: IsoDate = todayIso()): Promise<void> {
    const assets = await this.loadAssetsWithTransactions()

    for (const asset of assets) {
      if (asset.delisted && asset.transactionCount > 0) {
        await this.generateDelistedPrices(asset.ticker, today)
      }
    }

    const startDates = new Map<string, IsoDate>()
    const eligible: AssetTickerInfo[] = []
    const fiveYearsAgo = addDays(today, -365 * LOOKBACK_YEARS)

    for (const asset of assets) {
      if (asset.firstTransactionDate === null) continue

      const fullStart = (minDate([asset.firstTransactionDate, fiveYearsAgo]) ??
        fiveYearsAgo) as IsoDate
      const [firstStored, lastStored] = await Promise.all([
        this.getFirstStoredDate(asset.ticker),
        this.getLastStoredDate(asset.ticker),
      ])

      // Retomar do último preço gravado só vale quando a série já cobre a primeira transação.
      // A atualização diária grava só o preço de hoje, e uma transação pode ser lançada com
      // data retroativa: nos dois casos o topo da série não diz nada sobre o começo dela.
      // Tomá-lo como marca d'água deixaria o histórico antigo sem preço para sempre — e sem
      // preço a evolução patrimonial pula o mês inteiro.
      const coversHistory = firstStored !== null && firstStored <= asset.firstTransactionDate
      const start = coversHistory && lastStored !== null ? addDays(lastStored, 1) : fullStart
      if (start > today) continue

      startDates.set(asset.ticker, start)
      eligible.push({
        ticker: asset.ticker,
        yfTicker: asset.yfTicker,
        type: asset.type,
        delisted: asset.delisted,
      })
    }

    const maps = categorizeAssets(eligible)

    if (maps.yfTickerMap.size > 0) {
      const earliest =
        minDate([...maps.yfTickerMap.values()].flatMap((t) => startDates.get(t) ?? [])) ?? today
      const batch = await this.yahoo.fetchHistoricalQuotesBatch(maps.yfTickerMap, earliest)
      const records = filterBatchToRecords(
        batch,
        (ticker, date) => date >= (startDates.get(ticker) ?? earliest),
      )
      await this.upsertPrices(records)
      this.logger.info(`Backfill: ${records.length} preços do Yahoo`)
    }

    if (maps.tdTickerMap.size > 0) {
      const batch = await this.tesouro.fetchHistoricalQuotesBatch([...maps.tdTickerMap.keys()])
      const records = filterBatchToRecords(
        batch,
        (ticker, date) => date >= (startDates.get(ticker) ?? '0000-01-01'),
        (key) => maps.tdTickerMap.get(key) ?? null,
      )
      await this.upsertPrices(records)
      this.logger.info(`Backfill: ${records.length} preços do Tesouro`)
    }
  }

  /** Busca só o preço de hoje — roda no scheduler das 18:30. */
  async runDailyUpdate(today: IsoDate = todayIso()): Promise<void> {
    const assets = await this.loadAssetsWithTransactions()

    for (const asset of assets) {
      if (asset.delisted && asset.transactionCount > 0) {
        await this.generateDelistedPrices(asset.ticker, today)
      }
    }

    const withTransactions = assets
      .filter((a) => a.transactionCount > 0)
      .map(
        (a): AssetTickerInfo => ({
          ticker: a.ticker,
          yfTicker: a.yfTicker,
          type: a.type,
          delisted: a.delisted,
        }),
      )

    const maps = categorizeAssets(withTransactions)

    if (maps.yfTickerMap.size > 0) {
      const batch = await this.yahoo.fetchHistoricalQuotesBatch(maps.yfTickerMap, today)
      const records = filterBatchToRecords(batch, (_ticker, date) => date === today)
      await this.upsertPrices(records)
      this.logger.info(`Atualização diária: ${records.length} preços do Yahoo`)
    }

    if (maps.tdTickerMap.size > 0) {
      const batch = await this.tesouro.fetchHistoricalQuotesBatch([...maps.tdTickerMap.keys()])
      const records = filterBatchToRecords(
        batch,
        (_ticker, date) => date === today,
        (key) => maps.tdTickerMap.get(key) ?? null,
      )
      await this.upsertPrices(records)
      this.logger.info(`Atualização diária: ${records.length} preços do Tesouro`)
    }
  }

  /**
   * Ativos com a contagem e a primeira data de transação.
   *
   * O Kotlin acessava `asset.transactions` dentro do laço, uma query por ativo. Aqui são
   * duas queries no total.
   */
  private async loadAssetsWithTransactions(): Promise<
    Array<{
      ticker: string
      yfTicker: string | null
      type: string
      delisted: boolean
      transactionCount: number
      firstTransactionDate: IsoDate | null
    }>
  > {
    const [assets, grouped] = await Promise.all([
      this.db.asset.findMany({
        select: { ticker: true, yfTicker: true, type: true, delisted: true },
        orderBy: { ticker: 'asc' },
      }),
      this.db.transaction.groupBy({
        by: ['assetId'],
        _count: { _all: true },
        _min: { date: true },
      }),
    ])

    const stats = new Map(grouped.map((g) => [g.assetId, g]))
    return assets.map((asset) => {
      const stat = stats.get(asset.ticker)
      return {
        ...asset,
        transactionCount: stat?._count._all ?? 0,
        firstTransactionDate: (stat?._min.date as IsoDate | undefined) ?? null,
      }
    })
  }
}
