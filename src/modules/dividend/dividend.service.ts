import type { Db } from '../../config/db.js'
import type { CashFlow } from '../../domain/xirr.js'
import type { Dividend } from '../../generated/prisma/client.js'
import { HttpError } from '../../shared/http-error.js'
import type { IsoDate } from '../../shared/iso-date.js'
import type { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import type { TransactionService } from '../transaction/transaction.service.js'

/** Porte de src/main/kotlin/com/stocks/service/DividendService.kt. */

export type DividendInput = {
  type: string
  date: IsoDate
  totalAmount: number
  taxWithheld: number
  notes?: string | null
  broker?: string | null
  currency?: string
}

export class DividendService {
  constructor(
    private readonly db: Db,
    private readonly transactions: TransactionService,
    private readonly exchangeRates: ExchangeRateService,
  ) {}

  async createDividend(ticker: string, input: DividendInput): Promise<Dividend> {
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

  async listDividends(ticker?: string | null, type?: string | null): Promise<Dividend[]> {
    return this.db.dividend.findMany({
      where: {
        ...(ticker ? { assetId: ticker.toUpperCase() } : {}),
        ...(type ? { type: type.toUpperCase() } : {}),
      },
      orderBy: { date: 'desc' },
    })
  }

  async updateDividend(id: number, input: DividendInput): Promise<void> {
    const existing = await this.db.dividend.findUnique({ where: { id } })
    if (existing === null) throw HttpError.notFound('Dividend not found')

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
    if (existing === null) throw HttpError.notFound('Dividend not found')
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
