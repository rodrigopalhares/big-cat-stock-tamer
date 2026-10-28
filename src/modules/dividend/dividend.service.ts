import type { Db } from '../../config/db.js'
import { UNCLASSIFIED } from '../../domain/allocation.js'
import type { DividendFlow } from '../../domain/chart.js'
import type { CashFlow } from '../../domain/xirr.js'
import type { Dividend, Prisma } from '../../generated/prisma/client.js'
import { HttpError } from '../../shared/http-error.js'
import type { IsoDate } from '../../shared/iso-date.js'
import type { PageWindow } from '../../shared/page-window.js'
import type { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import type { TransactionService } from '../transaction/transaction.service.js'

/** Porte de src/main/kotlin/com/stocks/service/DividendService.kt. */

export type DividendInput = {
  type: string
  date: IsoDate
  totalAmount: number
  taxWithheld: number
  notes?: string | null | undefined
  broker?: string | null | undefined
  currency?: string
}

export type DividendFilters = {
  /** Ticker exato — a tela do ativo. */
  ticker?: string | null | undefined
  /** Trecho do ticker — a busca da lista. */
  search?: string | null | undefined
  /** Tipo do provento (DIVIDENDO, JCP…). */
  type?: string | null | undefined
  /** Tipo do papel que pagou (STOCK, REIT…) — filtra pela relação, não por coluna daqui. */
  assetType?: string | null | undefined
  year?: number | null | undefined
}

export class DividendService {
  constructor(
    private readonly db: Db,
    private readonly transactions: TransactionService,
    private readonly exchangeRates: ExchangeRateService,
  ) {}

  async createDividend(ticker: string, input: DividendInput): Promise<Dividend> {
    assertAmounts(input)
    const normalized = ticker.trim().toUpperCase()
    const currency = input.currency || 'BRL'
    const converted = await this.convertToBrl(
      input.totalAmount,
      input.taxWithheld,
      currency,
      input.date,
    )

    // Cria o ativo se necessário — pode envolver rede, então acontece antes da escrita.
    await this.transactions.findOrCreateAsset(normalized)

    return this.db.dividend.create({
      data: {
        assetId: normalized,
        type: input.type.trim().toUpperCase(),
        date: input.date,
        totalAmount: input.totalAmount,
        taxWithheld: input.taxWithheld,
        totalAmountBrl: converted.totalAmountBrl,
        taxWithheldBrl: converted.taxWithheldBrl,
        broker: blankToNull(input.broker),
        currency,
        notes: blankToNull(input.notes),
      },
    })
  }

  /** Sem [page] traz tudo; com ela, a janela que a rolagem infinita pediu. */
  async listDividends(filters: DividendFilters = {}, page?: PageWindow): Promise<Dividend[]> {
    return this.db.dividend.findMany({
      where: whereFor(filters),
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      ...(page === undefined ? {} : { take: page.limit, skip: page.offset }),
    })
  }

  async countDividends(filters: DividendFilters = {}): Promise<number> {
    return this.db.dividend.count({ where: whereFor(filters) })
  }

  /** Líquido em reais de tudo que o filtro pegou — o total da lista, não só da página. */
  async sumNetDividendsBrl(filters: DividendFilters = {}): Promise<number> {
    const sums = await this.db.dividend.aggregate({
      where: whereFor(filters),
      _sum: { totalAmountBrl: true, taxWithheldBrl: true },
    })
    return (sums._sum.totalAmountBrl ?? 0) - (sums._sum.taxWithheldBrl ?? 0)
  }

  /** Anos com provento, do mais recente ao mais antigo — as opções do filtro de ano. */
  async listYears(): Promise<number[]> {
    const rows = await this.db.$queryRaw<
      Array<{ year: string }>
    >`SELECT DISTINCT substr(date, 1, 4) AS year FROM dividends ORDER BY year DESC`
    return rows.map((row) => Number(row.year))
  }

  /**
   * Tipos de ativo que aparecem no histórico, para o filtro da tela. Sai da relação em vez
   * de `ASSET_TYPES` porque metade dos tipos nunca paga provento — oferecer TESOURO_DIRETO
   * ou CRYPTO num filtro que só devolve lista vazia é ruído.
   */
  async listAssetTypesWithDividends(): Promise<string[]> {
    const assets = await this.db.asset.findMany({
      where: { dividends: { some: {} } },
      select: { type: true },
      distinct: ['type'],
      orderBy: { type: 'asc' },
    })
    return assets.map((a) => a.type)
  }

  async updateDividend(id: number, input: DividendInput): Promise<void> {
    const existing = await this.db.dividend.findUnique({ where: { id } })
    if (existing === null) throw HttpError.notFound('Provento não encontrado')

    assertAmounts(input)
    const currency = input.currency || 'BRL'
    const converted = await this.convertToBrl(
      input.totalAmount,
      input.taxWithheld,
      currency,
      input.date,
    )

    await this.db.dividend.update({
      where: { id },
      data: {
        type: input.type.trim().toUpperCase(),
        date: input.date,
        totalAmount: input.totalAmount,
        taxWithheld: input.taxWithheld,
        totalAmountBrl: converted.totalAmountBrl,
        taxWithheldBrl: converted.taxWithheldBrl,
        broker: blankToNull(input.broker),
        currency,
        notes: blankToNull(input.notes),
      },
    })
  }

  async deleteDividend(id: number): Promise<void> {
    const existing = await this.db.dividend.findUnique({ where: { id } })
    if (existing === null) throw HttpError.notFound('Provento não encontrado')
    await this.db.dividend.delete({ where: { id } })
  }

  /** Provento líquido acumulado por ativo, em reais. */
  async getDividendPnlByAsset(): Promise<Map<string, number>> {
    const rows = await this.db.dividend.groupBy({
      by: ['assetId'],
      _sum: { totalAmountBrl: true, taxWithheldBrl: true },
    })
    return new Map(
      rows.map((row) => [
        row.assetId,
        (row._sum.totalAmountBrl ?? 0) - (row._sum.taxWithheldBrl ?? 0),
      ]),
    )
  }

  /** Fluxos de caixa de proventos por ativo, para o cálculo de XIRR. */
  async getDividendCashFlowsByAsset(): Promise<Map<string, CashFlow[]>> {
    const dividends = await this.db.dividend.findMany({
      select: { assetId: true, date: true, totalAmountBrl: true, taxWithheldBrl: true },
    })

    const byAsset = new Map<string, CashFlow[]>()
    for (const d of dividends) {
      const flow: CashFlow = {
        date: d.date as IsoDate,
        value: d.totalAmountBrl - d.taxWithheldBrl,
      }
      const list = byAsset.get(d.assetId)
      if (list === undefined) byAsset.set(d.assetId, [flow])
      else list.push(flow)
    }
    return byAsset
  }

  /**
   * Proventos líquidos em reais com o nome da classe do ativo que os pagou — insumo do
   * gráfico mensal do dashboard. Ativo sem classe cai em "Sem classe".
   */
  async getNetFlowsByAssetClass(): Promise<DividendFlow[]> {
    const dividends = await this.db.dividend.findMany({
      select: {
        date: true,
        totalAmountBrl: true,
        taxWithheldBrl: true,
        asset: { select: { assetClass: { select: { name: true } } } },
      },
      orderBy: { date: 'asc' },
    })
    return dividends.map((d) => ({
      date: d.date as IsoDate,
      group: d.asset.assetClass?.name ?? UNCLASSIFIED.name,
      net: d.totalAmountBrl - d.taxWithheldBrl,
    }))
  }

  private async convertToBrl(
    totalAmount: number,
    taxWithheld: number,
    currency: string,
    date: IsoDate,
  ): Promise<{ totalAmountBrl: number; taxWithheldBrl: number }> {
    if (currency === 'BRL') return { totalAmountBrl: totalAmount, taxWithheldBrl: taxWithheld }
    const rate = await this.exchangeRates.getRate(currency, 'BRL', date)
    return { totalAmountBrl: totalAmount * rate, taxWithheldBrl: taxWithheld * rate }
  }
}

function blankToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim() === '' ? null : value
}

function whereFor(filters: DividendFilters): Prisma.DividendWhereInput {
  const search = filters.search?.trim().toUpperCase() ?? ''
  const clauses: Prisma.DividendWhereInput[] = []
  if (filters.ticker) clauses.push({ assetId: filters.ticker.toUpperCase() })
  if (search !== '') clauses.push({ assetId: { contains: search } })
  if (filters.type) clauses.push({ type: filters.type.toUpperCase() })
  if (filters.assetType) clauses.push({ asset: { type: filters.assetType.toUpperCase() } })
  if (filters.year) {
    clauses.push({ date: { gte: `${filters.year}-01-01`, lte: `${filters.year}-12-31` } })
  }
  return clauses.length === 0 ? {} : { AND: clauses }
}

/**
 * Valor negativo passava pelo formulário e pelo lote (o `min` do HTML não vale para quem
 * edita o preview) e entrava calado no total de proventos. A API já exigia positivo — aqui
 * a regra vale para os três caminhos.
 */
function assertAmounts(input: DividendInput): void {
  if (!(input.totalAmount > 0)) throw HttpError.badRequest('Valor bruto deve ser maior que zero')
  if (!(input.taxWithheld >= 0)) throw HttpError.badRequest('IR retido não pode ser negativo')
  if (input.taxWithheld > input.totalAmount) {
    throw HttpError.badRequest('IR retido não pode superar o valor bruto')
  }
}
