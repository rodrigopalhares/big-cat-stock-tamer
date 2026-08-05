import type { Db } from '../../config/db.js'
import { calculateXirr } from '../../domain/calculation.js'
import { type CdiRate, simulateCdi } from '../../domain/cdi.js'
import { annualToMonthlyRate } from '../../domain/regression.js'
import type { CashFlow } from '../../domain/xirr.js'
import type { BcbClient } from '../../integrations/bcb/bcb.client.js'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'
import { addDays, type IsoDate, today as todayIso } from '../../shared/iso-date.js'
import type { PortfolioSummary } from '../portfolio/portfolio.schema.js'
import type { CdiComparison } from './cdi.schema.js'

/**
 * Série diária do CDI e a comparação da carteira contra ela.
 *
 * A série é povoada pelo job das 18:30 e pelo botão "Atualizar Cotações" — nunca no render
 * do dashboard, que não pode bloquear numa chamada ao BCB. `compare` só lê o que está
 * gravado; série defasada vira uma data na tela, não uma requisição.
 */
export class CdiService {
  constructor(
    private readonly db: Db,
    private readonly bcb: BcbClient,
    private readonly logger: Logger = silentLogger,
  ) {}

  /**
   * Traz do BCB o que falta da série, retomando do último dia gravado.
   *
   * Um método só cobre a carga inicial (do primeiro aporte até hoje), o incremento diário
   * e a recuperação de uma janela perdida — a diferença é só o ponto de partida.
   *
   * O CDI do dia sai à noite, então às 18:30 o dia corrente às vezes ainda não existe.
   * Não precisa de tratamento: como a próxima execução retoma do último gravado, o dia
   * entra sozinho no dia seguinte.
   *
   * Devolve quantas taxas gravou.
   */
  async runBackfill(today: IsoDate = todayIso()): Promise<number> {
    const start = await this.nextDateToFetch()
    if (start === null) {
      this.logger.info('Sem transação: nada a buscar da série do CDI')
      return 0
    }
    if (start > today) return 0

    // Rede fora de transação: o SQLite tem escritor único e segurar o lock durante o HTTP
    // travaria a aplicação inteira.
    const rates = await this.bcb.fetchCdiDailyRange(start, today)
    if (rates.length === 0) {
      this.logger.warn(`Série do CDI não devolveu taxa entre ${start} e ${today}`)
      return 0
    }

    await this.db.$transaction(
      rates.map((r) =>
        this.db.cdiRate.upsert({
          where: { date: r.date },
          create: { date: r.date, rate: r.rate },
          update: { rate: r.rate },
        }),
      ),
    )

    this.logger.info(`Gravadas ${rates.length} taxas do CDI a partir de ${start}`)
    return rates.length
  }

  async getRates(): Promise<CdiRate[]> {
    const rows = await this.db.cdiRate.findMany({
      orderBy: { date: 'asc' },
      select: { date: true, rate: true },
    })
    return rows.map((r) => ({ date: r.date as IsoDate, rate: r.rate }))
  }

  /**
   * A carteira contra a sombra no CDI, sobre os mesmos fluxos.
   *
   * Null quando não há série gravada ou não há valor de mercado — sem um dos dois a
   * comparação não existe, e mostrar zero seria pior que não mostrar nada.
   */
  async compare(
    summary: PortfolioSummary,
    today: IsoDate = todayIso(),
  ): Promise<CdiComparison | null> {
    const portfolioValue = summary.currentValue
    if (portfolioValue === null) return null

    const rates = await this.getRates()
    if (rates.length === 0) return null

    const cashFlows = allCashFlowsOf(summary)
    if (cashFlows.length === 0) return null

    const { finalValue, lastRateDate } = simulateCdi(cashFlows, rates, today)
    // Mesmo cronograma dos dois lados: é isso que torna a comparação de TIR legítima.
    const cdiIrrAnnual = calculateXirr(cashFlows, finalValue, today)

    return {
      cdiValue: finalValue,
      portfolioValue,
      difference: portfolioValue - finalValue,
      ratioOfCdi: finalValue > 0 ? portfolioValue / finalValue : null,
      cdiIrrAnnual,
      cdiIrrMonthly: cdiIrrAnnual === null ? null : annualToMonthlyRate(cdiIrrAnnual),
      lastRateDate,
    }
  }

  /** Um dia depois da última taxa gravada, ou a data do primeiro aporte se não há nenhuma. */
  private async nextDateToFetch(): Promise<IsoDate | null> {
    const last = await this.db.cdiRate.findFirst({
      orderBy: { date: 'desc' },
      select: { date: true },
    })
    if (last !== null) return addDays(last.date as IsoDate, 1)

    const first = await this.db.transaction.aggregate({ _min: { date: true } })
    return (first._min.date as IsoDate | null) ?? null
  }
}

/** Todos os fluxos da carteira em reais, na ordem — o mesmo insumo da TIR do dashboard. */
function allCashFlowsOf(summary: PortfolioSummary): CashFlow[] {
  return summary.positions
    .flatMap((p) => p.allCashFlowsBrl)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
