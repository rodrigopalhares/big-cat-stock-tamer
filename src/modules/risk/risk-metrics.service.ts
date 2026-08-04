import type { Db } from '../../config/db.js'
import {
  annualToMonthlyRate,
  computeMonthlyReturns,
  linearRegression,
  monthlyToAnnualRate,
} from '../../domain/regression.js'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'
import {
  addMonths,
  firstDayOf,
  type IsoDate,
  today as todayIso,
  yearMonth,
} from '../../shared/iso-date.js'
import type { BenchmarkService } from './benchmark.service.js'

/** Porte de src/main/kotlin/com/stocks/service/RiskMetricsService.kt. */

/** Abaixo disso a regressão existe, mas não é confiável o bastante para decidir nada. */
export const MIN_RELIABLE_DATA_POINTS = 12
const LOOKBACK_YEARS = 5
const RISK_ASSET_TYPES = ['STOCK', 'REIT']

/** `with` esconde quem não tem posição aberta; `all` lista todo ativo já calculado. */
export type PositionFilter = 'with' | 'all'

export type RiskMetricsResult = {
  ticker: string
  name: string | null
  type: string | null
  hasPosition: boolean
  currentValue: number
  /** Fatia que a posição ocupa dentro do próprio tipo; null quando o tipo não vale nada. */
  typeShare: number | null
  beta: number | null
  alphaAnnual: number | null
  rSquared: number | null
  dataPoints: number
  reliable: boolean
}

export type RiskMetricsSummary = {
  metrics: RiskMetricsResult[]
  portfolioBeta: number | null
  cdiAnnual: number | null
  calculatedAt: IsoDate | null
}

export class RiskMetricsService {
  constructor(
    private readonly db: Db,
    private readonly benchmarks: BenchmarkService,
    private readonly logger: Logger = silentLogger,
  ) {}

  /** Recalcula beta, alfa e R² de cada ação e FII contra o Ibovespa. */
  async recalculate(today: IsoDate = todayIso()): Promise<void> {
    await this.benchmarks.fetchAndStoreIbovMonthly(today)

    const ibovPrices = await this.benchmarks.getMonthlyPricesMap()
    if (ibovPrices.size < 2) {
      this.logger.warn('Dados do IBOV insuficientes para calcular métricas de risco')
      return
    }

    const cdiAnnual = await this.benchmarks.fetchCdiAnnualRate()
    const rfMonthly = cdiAnnual === null ? 0 : annualToMonthlyRate(cdiAnnual)
    const cutoffDate = firstDayOf(yearMonth(addMonths(today, -12 * LOOKBACK_YEARS)))

    const ibovReturns = computeMonthlyReturns(ibovPrices, cutoffDate)
    if (ibovReturns.size < 2) {
      this.logger.warn('Retornos mensais do IBOV insuficientes para a regressão')
      return
    }

    const assets = await this.eligibleAssets()

    for (const ticker of assets) {
      const assetPrices = await this.monthlyPrices(ticker, cutoffDate)
      if (assetPrices.size < 2) {
        await this.storeResult(ticker, today, null, 0, cdiAnnual)
        continue
      }

      const assetReturns = computeMonthlyReturns(assetPrices, cutoffDate)
      // Só meses presentes nas duas séries — regressão exige pares.
      const commonMonths = [...assetReturns.keys()].filter((m) => ibovReturns.has(m)).sort()

      if (commonMonths.length < 2) {
        await this.storeResult(ticker, today, null, commonMonths.length, cdiAnnual)
        continue
      }

      const excessAsset = commonMonths.map((m) => (assetReturns.get(m) as number) - rfMonthly)
      const excessIbov = commonMonths.map((m) => (ibovReturns.get(m) as number) - rfMonthly)

      const regression = linearRegression(excessIbov, excessAsset)
      if (regression === null) {
        await this.storeResult(ticker, today, null, commonMonths.length, cdiAnnual)
        continue
      }

      await this.storeResult(
        ticker,
        today,
        {
          beta: regression.beta,
          alpha: monthlyToAnnualRate(regression.alpha),
          rSquared: regression.rSquared,
        },
        regression.dataPoints,
        cdiAnnual,
      )
    }

    this.logger.info(`Métricas de risco recalculadas para ${assets.length} ativos`)
  }

  /** Última rodada de métricas, com o beta da carteira ponderado pelo valor de cada posição. */
  async getSummary(position: PositionFilter = 'with'): Promise<RiskMetricsSummary> {
    const latest = await this.db.riskMetric.findFirst({
      orderBy: { calculatedAt: 'desc' },
      select: { calculatedAt: true },
    })
    if (latest === null) {
      return { metrics: [], portfolioBeta: null, cdiAnnual: null, calculatedAt: null }
    }

    const rows = await this.db.riskMetric.findMany({ where: { calculatedAt: latest.calculatedAt } })
    const assets = await this.db.asset.findMany({
      where: { type: { in: RISK_ASSET_TYPES } },
      select: { ticker: true, name: true, type: true, quantity: true, hasPosition: true },
    })
    const assetByTicker = new Map(assets.map((a) => [a.ticker, a]))

    const currentValues = await this.currentValues(rows.map((r) => r.ticker))

    // Somado sobre todos os ativos, mesmo os que o filtro vai esconder: quem não tem
    // posição vale zero e não muda o total do tipo.
    const totalByType = new Map<string, number>()
    for (const row of rows) {
      const type = assetByTicker.get(row.ticker)?.type
      if (type === undefined || type === null) continue
      totalByType.set(type, (totalByType.get(type) ?? 0) + (currentValues.get(row.ticker) ?? 0))
    }

    const all: RiskMetricsResult[] = rows
      // Sem regressão a linha inteira seria um traço em cada coluna — não informa nada.
      // O ativo continua contando no total do tipo e no beta da carteira, só não é listado.
      .filter((row) => row.beta !== null)
      .map((row) => {
        const asset = assetByTicker.get(row.ticker)
        const currentValue = currentValues.get(row.ticker) ?? 0
        const typeTotal = asset?.type == null ? 0 : (totalByType.get(asset.type) ?? 0)
        return {
          ticker: row.ticker,
          name: asset?.name ?? null,
          type: asset?.type ?? null,
          hasPosition: (asset?.hasPosition ?? false) && (asset?.quantity ?? 0) > 0,
          currentValue,
          typeShare: typeTotal > 0 ? currentValue / typeTotal : null,
          beta: row.beta,
          alphaAnnual: row.alpha,
          rSquared: row.rSquared,
          dataPoints: row.dataPoints,
          reliable: row.dataPoints >= MIN_RELIABLE_DATA_POINTS,
        }
      })
      .sort(
        (a, b) => (a.type ?? '').localeCompare(b.type ?? '') || a.ticker.localeCompare(b.ticker),
      )

    // O beta da carteira ignora o filtro: ele descreve a carteira inteira, não a lista à vista.
    const totalValue = [...currentValues.values()].reduce((total, v) => total + v, 0)
    const portfolioBeta =
      totalValue > 0
        ? all
            .filter((m) => m.beta !== null)
            .reduce((total, m) => total + (m.currentValue / totalValue) * (m.beta as number), 0)
        : null

    return {
      metrics: position === 'all' ? all : all.filter((m) => m.hasPosition),
      portfolioBeta,
      cdiAnnual: rows[0]?.cdiAnnual ?? null,
      calculatedAt: latest.calculatedAt as IsoDate,
    }
  }

  private async eligibleAssets(): Promise<string[]> {
    const withTransactions = await this.db.transaction.groupBy({ by: ['assetId'] })
    const tickers = new Set(withTransactions.map((t) => t.assetId))

    const assets = await this.db.asset.findMany({
      where: { type: { in: RISK_ASSET_TYPES } },
      select: { ticker: true },
      orderBy: { ticker: 'asc' },
    })
    return assets.map((a) => a.ticker).filter((ticker) => tickers.has(ticker))
  }

  /** Último preço de cada mês do ativo, a partir do histórico diário. */
  private async monthlyPrices(ticker: string, cutoffDate: IsoDate): Promise<Map<IsoDate, number>> {
    const rows = await this.db.priceHistory.findMany({
      where: { assetId: ticker, date: { gte: cutoffDate } },
      orderBy: { date: 'asc' },
      select: { date: true, close: true },
    })

    const byMonth = new Map<IsoDate, number>()
    for (const row of rows) {
      byMonth.set(firstDayOf(yearMonth(row.date as IsoDate)), row.close)
    }
    return byMonth
  }

  private async currentValues(tickers: readonly string[]): Promise<Map<string, number>> {
    const values = new Map<string, number>()
    for (const ticker of tickers) {
      const asset = await this.db.asset.findUnique({
        where: { ticker },
        select: { quantity: true, hasPosition: true },
      })
      if (asset === null || !asset.hasPosition || asset.quantity <= 0) {
        values.set(ticker, 0)
        continue
      }
      const price = await this.db.priceHistory.findFirst({
        where: { assetId: ticker },
        orderBy: { date: 'desc' },
        select: { close: true },
      })
      values.set(ticker, price === null ? 0 : asset.quantity * price.close)
    }
    return values
  }

  private async storeResult(
    ticker: string,
    date: IsoDate,
    regression: { beta: number; alpha: number; rSquared: number } | null,
    dataPoints: number,
    cdiAnnual: number | null,
  ): Promise<void> {
    const data = {
      beta: regression?.beta ?? null,
      alpha: regression?.alpha ?? null,
      rSquared: regression?.rSquared ?? null,
      dataPoints,
      cdiAnnual,
    }
    await this.db.riskMetric.upsert({
      where: { ticker_calculatedAt: { ticker, calculatedAt: date } },
      create: { ticker, calculatedAt: date, ...data },
      update: data,
    })
  }
}
