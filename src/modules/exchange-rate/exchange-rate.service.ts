import type { Db } from '../../config/db.js'
import type { BcbClient } from '../../integrations/bcb/bcb.client.js'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'
import { addDays, type IsoDate, today } from '../../shared/iso-date.js'

/**
 * Cotações de câmbio, com backfill sob demanda a partir do PTAX do Banco Central.
 * Porte de src/main/kotlin/com/stocks/service/ExchangeRateService.kt.
 */
export class ExchangeRateService {
  constructor(
    private readonly db: Db,
    private readonly bcb: BcbClient,
    private readonly logger: Logger = silentLogger,
  ) {}

  /**
   * Taxa de conversão na data. Quando não há cotação gravada, busca o período inteiro
   * no BCB e tenta de novo; em último caso usa a cotação mais recente disponível.
   *
   * Lança quando nem isso existe — sem taxa não há como converter, e gravar a transação
   * com um valor inventado seria pior que falhar.
   */
  async getRate(
    fromCurrency: string,
    toCurrency = 'BRL',
    date: IsoDate = today(),
  ): Promise<number> {
    if (fromCurrency === toCurrency) return 1

    const existing = await this.findRate(fromCurrency, toCurrency, date)
    if (existing !== null) return existing

    await this.backfillFromBcb(fromCurrency, toCurrency)

    const afterBackfill = await this.findRate(fromCurrency, toCurrency, date)
    if (afterBackfill !== null) return afterBackfill

    const closest = await this.findClosestRate(fromCurrency, toCurrency, date)
    if (closest !== null) return closest

    throw new Error(`Sem cotação de ${fromCurrency}/${toCurrency} para ${date}`)
  }

  async findRate(fromCurrency: string, toCurrency: string, date: IsoDate): Promise<number | null> {
    const row = await this.db.exchangeRate.findFirst({
      where: { date, fromCurrency, toCurrency },
      select: { sellRate: true },
    })
    return row?.sellRate ?? null
  }

  /** Cotação mais recente do par, independente da data pedida. */
  async findClosestRate(
    fromCurrency: string,
    toCurrency: string,
    _date: IsoDate,
  ): Promise<number | null> {
    const row = await this.db.exchangeRate.findFirst({
      where: { fromCurrency, toCurrency },
      orderBy: { date: 'desc' },
      select: { sellRate: true },
    })
    return row?.sellRate ?? null
  }

  /**
   * Busca o período no BCB e grava uma cotação para *cada dia*, repetindo a última
   * conhecida em fins de semana e feriados — senão uma transação de sábado ficaria sem taxa.
   *
   * A chamada de rede acontece antes da transação: o SQLite tem escritor único e segurar
   * o lock durante a latência do BCB bloquearia a aplicação inteira (regra §3.3 do plano).
   */
  async backfillFromBcb(fromCurrency: string, toCurrency: string): Promise<void> {
    const startDate = (await this.findOldestTransactionDate()) ?? today()
    const endDate = today()

    const quotes = await this.bcb.fetchPtaxRange(startDate, endDate)
    if (quotes.length === 0) {
      this.logger.warn(`BCB não devolveu cotações de ${startDate} a ${endDate}`)
      return
    }

    const byDate = new Map(quotes.map((q) => [q.date, q]))
    const toWrite: Array<{ date: IsoDate; buyRate: number; sellRate: number }> = []

    let lastBuyRate: number | null = null
    let lastSellRate: number | null = null
    for (let current = startDate; current <= endDate; current = addDays(current, 1)) {
      const quote = byDate.get(current)
      if (quote !== undefined) {
        lastBuyRate = quote.buyRate
        lastSellRate = quote.sellRate
      }
      if (lastBuyRate !== null && lastSellRate !== null) {
        toWrite.push({ date: current, buyRate: lastBuyRate, sellRate: lastSellRate })
      }
    }

    await this.db.$transaction(
      toWrite.map((rate) =>
        this.db.exchangeRate.upsert({
          where: {
            date_fromCurrency_toCurrency: { date: rate.date, fromCurrency, toCurrency },
          },
          create: { ...rate, fromCurrency, toCurrency },
          update: { buyRate: rate.buyRate, sellRate: rate.sellRate },
        }),
      ),
    )

    this.logger.info(
      `Cotações de ${fromCurrency}/${toCurrency} preenchidas de ${startDate} a ${endDate}`,
    )
  }

  async upsertRate(
    date: IsoDate,
    fromCurrency: string,
    toCurrency: string,
    buyRate: number,
    sellRate: number,
  ): Promise<void> {
    await this.db.exchangeRate.upsert({
      where: { date_fromCurrency_toCurrency: { date, fromCurrency, toCurrency } },
      create: { date, fromCurrency, toCurrency, buyRate, sellRate },
      update: { buyRate, sellRate },
    })
  }

  private async findOldestTransactionDate(): Promise<IsoDate | null> {
    const row = await this.db.transaction.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true },
    })
    return (row?.date as IsoDate | undefined) ?? null
  }
}
