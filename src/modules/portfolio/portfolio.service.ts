import type { Db } from '../../config/db.js'
import {
  buildCashFlows,
  calculateIrr,
  calculateNetContribution,
  calculateUnrealizedPnl,
  calculateXirr,
} from '../../domain/calculation.js'
import { annualToMonthlyRate } from '../../domain/regression.js'
import type { CashFlow } from '../../domain/xirr.js'
import type { Asset, Transaction } from '../../generated/prisma/client.js'
import { compareDates, type IsoDate, today as todayIso } from '../../shared/iso-date.js'
import { toTransactionData } from '../asset/asset.service.js'
import type { DividendService } from '../dividend/dividend.service.js'
import type { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import type { PriceHistoryService } from '../price-history/price-history.service.js'
import type { AssetPosition, PortfolioSummary } from './portfolio.schema.js'

/** Porte de src/main/kotlin/com/stocks/service/PortfolioService.kt. */
export class PortfolioService {
  constructor(
    private readonly db: Db,
    private readonly priceHistory: PriceHistoryService,
    private readonly dividends: DividendService,
    private readonly exchangeRates: ExchangeRateService,
  ) {}

  /**
   * Monta a posição consolidada de cada ativo, com o último preço gravado.
   *
   * Não busca nada fora: a cotação chega pelo job das 18:30 e pelo botão de atualizar
   * cotações. Buscar aqui fazia a primeira abertura do dia esperar ~20s pelo Yahoo, pelo
   * CSV do Tesouro e pelo PTAX, um depois do outro — e a de ontem basta para a tela, que
   * mostra a data dela.
   */
  async buildPositions(
    assets: readonly Asset[],
    today: IsoDate = todayIso(),
  ): Promise<AssetPosition[]> {
    // Uma query para todas as transações, em vez de uma por ativo (o N+1 do Kotlin).
    const [transactionsByAsset, dividendPnl, dividendCashFlows] = await Promise.all([
      this.loadTransactionsByAsset(assets.map((a) => a.ticker)),
      this.dividends.getDividendPnlByAsset(),
      this.dividends.getDividendCashFlowsByAsset(),
    ])

    const positions: AssetPosition[] = []
    for (const asset of assets) {
      // Sem posição e sem resultado realizado, não há o que mostrar.
      if (!asset.hasPosition && asset.realizedPnl === 0) continue

      const latest = await this.priceHistory.getLatestPrice(asset.ticker)
      const currentPrice = latest?.[1] ?? null

      const unrealizedPnl =
        currentPrice !== null && asset.hasPosition
          ? calculateUnrealizedPnl(asset.quantity, asset.avgPrice, currentPrice)
          : null
      const currentValue =
        currentPrice !== null && asset.hasPosition ? currentPrice * asset.quantity : null

      const assetDividendFlows = dividendCashFlows.get(asset.ticker) ?? []
      const txFlows = buildCashFlows(
        (transactionsByAsset.get(asset.ticker) ?? []).map(toTransactionData),
      )
      const allCashFlows = sortByDate([...txFlows.cashFlows, ...assetDividendFlows])
      const allCashFlowsBrl = sortByDate([...txFlows.cashFlowsBrl, ...assetDividendFlows])

      const irrAnnual = calculateXirr(allCashFlows, currentValue, today)
      const exchangeRate =
        asset.currency === 'BRL' ? null : await this.exchangeRates.getLatestRate(asset.currency)

      positions.push({
        ticker: asset.ticker,
        name: asset.name,
        type: asset.type,
        quantity: asset.quantity,
        avgPrice: asset.avgPrice,
        avgPriceBrl: asset.avgPriceBrl,
        totalCost: asset.totalCost,
        totalCostBrl: asset.totalCostBrl,
        currentPrice,
        priceDate: latest?.[0] ?? null,
        currentPriceBrl: scale(currentPrice, exchangeRate),
        currentValue,
        unrealizedPnl,
        realizedPnl: asset.realizedPnl,
        realizedPnlBrl: asset.realizedPnlBrl,
        dividendPnl: dividendPnl.get(asset.ticker) ?? 0,
        irr: calculateIrr(allCashFlows, currentValue),
        irrAnnual,
        irrMonthly: irrAnnual === null ? null : annualToMonthlyRate(irrAnnual),
        currency: asset.currency,
        exchangeRate,
        currentValueBrl: scale(currentValue, exchangeRate),
        unrealizedPnlBrl: scale(unrealizedPnl, exchangeRate),
        delisted: asset.delisted,
        allCashFlowsBrl,
      })
    }

    return positions
  }

  /** Consolida as posições num resumo da carteira. */
  aggregatePositions(
    positions: readonly AssetPosition[],
    today: IsoDate = todayIso(),
  ): PortfolioSummary {
    const valuesBrl = positions.map((p) => p.currentValueBrl).filter(isNumber)
    const unrealizedBrl = positions.map((p) => p.unrealizedPnlBrl).filter(isNumber)

    const currentValue = valuesBrl.length > 0 ? sum(valuesBrl) : null
    const allCashFlowsBrl = sortByDate(positions.flatMap((p) => p.allCashFlowsBrl))
    const irrAnnual = calculateXirr(allCashFlowsBrl, currentValue, today)

    return {
      totalInvested: sum(positions.map((p) => p.totalCostBrl)),
      // A carteira inteira de uma vez, não a soma por ativo: o provento de um papel
      // pagando a compra de outro só aparece olhando os fluxos juntos, em ordem.
      netContribution: calculateNetContribution(allCashFlowsBrl),
      currentValue,
      realizedPnl: sum(positions.map((p) => p.realizedPnlBrl)),
      unrealizedPnl: unrealizedBrl.length > 0 ? sum(unrealizedBrl) : null,
      dividendPnl: sum(positions.map((p) => p.dividendPnl)),
      irrAnnual,
      irrMonthly: irrAnnual === null ? null : annualToMonthlyRate(irrAnnual),
      positions: [...positions],
    }
  }

  private async loadTransactionsByAsset(
    tickers: readonly string[],
  ): Promise<Map<string, Transaction[]>> {
    const transactions = await this.db.transaction.findMany({
      where: { assetId: { in: [...tickers] } },
    })
    const byAsset = new Map<string, Transaction[]>()
    for (const tx of transactions) {
      const list = byAsset.get(tx.assetId)
      if (list === undefined) byAsset.set(tx.assetId, [tx])
      else list.push(tx)
    }
    return byAsset
  }
}

function scale(value: number | null, rate: number | null): number | null {
  if (value === null) return null
  return rate === null ? value : value * rate
}

function sortByDate(flows: CashFlow[]): CashFlow[] {
  return flows.sort((a, b) => compareDates(a.date, b.date))
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function isNumber(value: number | null): value is number {
  return value !== null
}
