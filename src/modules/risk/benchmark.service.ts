import type { Db } from '../../config/db.js'
import type { BcbClient } from '../../integrations/bcb/bcb.client.js'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'
import type { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import {
  addMonths,
  firstDayOf,
  type IsoDate,
  today as todayIso,
  yearMonth,
} from '../../shared/iso-date.js'

/** Porte de src/main/kotlin/com/stocks/service/BenchmarkService.kt. */

export const IBOV_YF_TICKER = '^BVSP'
export const IBOV_TICKER = 'IBOV'

const LOOKBACK_YEARS = 5

export class BenchmarkService {
  constructor(
    private readonly db: Db,
    private readonly yahoo: YahooClient,
    private readonly bcb: BcbClient,
    private readonly logger: Logger = silentLogger,
  ) {}

  /** Baixa o histórico do Ibovespa e guarda o último preço de cada mês. */
  async fetchAndStoreIbovMonthly(today: IsoDate = todayIso()): Promise<void> {
    const startDate = firstDayOf(yearMonth(addMonths(today, -12 * LOOKBACK_YEARS)))
    const prices = await this.yahoo.fetchHistoricalQuotesBatch(
      new Map([[IBOV_YF_TICKER, IBOV_TICKER]]),
      startDate,
    )

    const daily = prices.get(IBOV_TICKER)
    if (daily === undefined || daily.length === 0) {
      this.logger.warn('Yahoo não devolveu histórico do IBOV')
      return
    }

    // Último preço disponível de cada mês.
    const lastOfMonth = new Map<string, number>()
    for (const [date, close] of daily) {
      const month = firstDayOf(yearMonth(date))
      const current = lastOfMonth.get(month)
      if (current === undefined || date >= month) lastOfMonth.set(month, close)
    }

    await this.db.$transaction(
      [...lastOfMonth].map(([month, close]) =>
        this.db.benchmarkPrice.upsert({
          where: { ticker_month: { ticker: IBOV_TICKER, month } },
          create: { ticker: IBOV_TICKER, month, close },
          update: { close },
        }),
      ),
    )

    this.logger.info(`Gravados ${lastOfMonth.size} preços mensais do IBOV`)
  }

  async getMonthlyPrices(ticker = IBOV_TICKER): Promise<Array<[IsoDate, number]>> {
    const rows = await this.db.benchmarkPrice.findMany({
      where: { ticker },
      orderBy: { month: 'asc' },
      select: { month: true, close: true },
    })
    return rows.map((r) => [r.month as IsoDate, r.close])
  }

  async getMonthlyPricesMap(ticker = IBOV_TICKER): Promise<Map<IsoDate, number>> {
    return new Map(await this.getMonthlyPrices(ticker))
  }

  async hasData(ticker = IBOV_TICKER): Promise<boolean> {
    return (await this.db.benchmarkPrice.count({ where: { ticker } })) > 0
  }

  /** Taxa anual do CDI, usada como proxy do ativo livre de risco. */
  async fetchCdiAnnualRate(): Promise<number | null> {
    return this.bcb.fetchCdiAnnualRate()
  }

  async clearBenchmarkData(ticker = IBOV_TICKER): Promise<void> {
    await this.db.benchmarkPrice.deleteMany({ where: { ticker } })
  }
}
