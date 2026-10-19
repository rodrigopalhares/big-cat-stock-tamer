import type { Db } from '../../config/db.js'
import type { BcbClient } from '../../integrations/bcb/bcb.client.js'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'
import { addDays, type IsoDate, today } from '../../shared/iso-date.js'

/** Quantos dias antes da última taxa gravada o backfill recomeça. */
const REFETCH_DAYS = 7

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
   * Taxa de conversão na data. Quando não há cotação gravada, busca no BCB o que
   * falta e tenta de novo; em último caso usa a cotação mais recente disponível.
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

  /**
   * Taxa mais recente gravada, sem ir ao BCB — é a que as telas usam. Quem busca a do dia
   * é o `backfillFromBcb`, chamado pelo job das 18:30 e pelo botão de atualizar cotações.
   *
   * Só cai no `getRate` quando não há taxa nenhuma do par: converter sem taxa trataria o
   * dólar como real, e isso só acontece uma vez, antes da primeira cotação gravada.
   */
  async getLatestRate(fromCurrency: string, toCurrency = 'BRL'): Promise<number> {
    if (fromCurrency === toCurrency) return 1
    return (
      (await this.findClosestRate(fromCurrency, toCurrency, today())) ??
      this.getRate(fromCurrency, toCurrency)
    )
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
    const startDate = await this.backfillStart(fromCurrency, toCurrency)
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

  /**
   * De onde o backfill começa: da transação mais antiga quando a série não a cobre, senão
   * de uma semana antes da última taxa gravada.
   *
   * Recomeçar sempre do começo regravava os 18 anos de série a cada dia novo, dentro da
   * requisição de quem pediu a taxa. O recuo existe porque o dia sem PTAX publicado ainda —
   * hoje antes das 13h, um feriado — entra com a taxa anterior repetida, e é na volta
   * seguinte que ela é trocada pela de verdade.
   */
  private async backfillStart(fromCurrency: string, toCurrency: string): Promise<IsoDate> {
    const oldestTransaction = (await this.findOldestTransactionDate()) ?? today()
    const [first, last] = await Promise.all(
      (['asc', 'desc'] as const).map((order) =>
        this.db.exchangeRate.findFirst({
          where: { fromCurrency, toCurrency },
          orderBy: { date: order },
          select: { date: true },
        }),
      ),
    )
    if (first == null || last == null || oldestTransaction < first.date) return oldestTransaction

    const resume = addDays(last.date as IsoDate, -REFETCH_DAYS)
    return resume > oldestTransaction ? resume : oldestTransaction
  }

  private async findOldestTransactionDate(): Promise<IsoDate | null> {
    const row = await this.db.transaction.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true },
    })
    return (row?.date as IsoDate | undefined) ?? null
  }
}
