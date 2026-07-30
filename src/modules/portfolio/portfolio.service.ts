import type { Db } from '../../config/db.js'
import {
  buildCashFlows,
  calculateIrr,
  calculateNetContribution,
  calculateUnrealizedPnl,
  calculateXirr,
} from '../../domain/calculation.js'
import { type AssetType, NO_QUOTE_TYPES } from '../../domain/constants.js'
import {
  type PriceRecord,
  resolveTesouroSymbol,
  resolveYfTicker,
} from '../../domain/price-history.js'
import { annualToMonthlyRate } from '../../domain/regression.js'
import type { CashFlow } from '../../domain/xirr.js'
import type { Asset, Transaction } from '../../generated/prisma/client.js'
import type { TesouroClient } from '../../integrations/tesouro/tesouro.client.js'
import type { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
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
    private readonly yahoo: YahooClient,
    private readonly tesouro: TesouroClient,
    private readonly priceHistory: PriceHistoryService,
    private readonly dividends: DividendService,
    private readonly exchangeRates: ExchangeRateService,
  ) {}

  /**
   * Monta a posição consolidada de cada ativo.
   *
   * Com [fetchQuotes], busca cotação do dia — mas só do que ainda não está no banco,
   * e grava o que vier da API para a próxima chamada não repetir o trabalho.
   */
  async buildPositions(
    assets: readonly Asset[],
    fetchQuotes = false,
    today: IsoDate = todayIso(),
  ): Promise<AssetPosition[]> {
    const liveQuotes = fetchQuotes ? await this.resolveLiveQuotes(assets, today) : new Map()

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

      const currentPrice = fetchQuotes
        ? (liveQuotes.get(quoteKey(asset) ?? '') ??
          (await this.priceHistory.getLatestPrice(asset.ticker)))
        : await this.priceHistory.getLatestPrice(asset.ticker)

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
        asset.currency === 'BRL' ? null : await this.exchangeRates.getRate(asset.currency)

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

  /**
   * Cotação do dia por símbolo. Usa o que já está no banco e só chama a API para o resto,
   * gravando o resultado — assim o dashboard recarregado não repete a busca.
   */
  private async resolveLiveQuotes(
    assets: readonly Asset[],
    today: IsoDate,
  ): Promise<Map<string, number>> {
    const yfToAsset = new Map<string, string>()
    const tdToAsset = new Map<string, string>()

    const withTransactions = await this.tickersWithTransactions()
    for (const asset of assets) {
      if (!withTransactions.has(asset.ticker)) continue
      if (asset.delisted) continue
      if (asset.type !== null && NO_QUOTE_TYPES.has(asset.type as AssetType)) continue

      if (asset.type === 'TESOURO_DIRETO') {
        const symbol = resolveTesouroSymbol(asset.ticker, asset.yfTicker)
        if (symbol !== null) tdToAsset.set(symbol, asset.ticker)
      } else {
        yfToAsset.set(resolveYfTicker(asset.ticker, asset.yfTicker), asset.ticker)
      }
    }

    const allTickers = [...yfToAsset.values(), ...tdToAsset.values()]
    const storedToday =
      allTickers.length > 0
        ? await this.priceHistory.getPricesForDate(allTickers, today)
        : new Map<string, number>()

    const liveQuotes = new Map<string, number>()
    const yfToFetch: string[] = []
    const tdToFetch: string[] = []

    for (const [symbol, assetTicker] of yfToAsset) {
      const stored = storedToday.get(assetTicker)
      if (stored !== undefined) liveQuotes.set(symbol, stored)
      else yfToFetch.push(symbol)
    }
    for (const [symbol, assetTicker] of tdToAsset) {
      const stored = storedToday.get(assetTicker)
      if (stored !== undefined) liveQuotes.set(symbol, stored)
      else tdToFetch.push(symbol)
    }

    if (yfToFetch.length > 0) {
      const fetched = await this.yahoo.fetchQuotesBatch(yfToFetch)
      await this.storeQuotes(fetched, yfToAsset, today, liveQuotes)
    }
    if (tdToFetch.length > 0) {
      const fetched = await this.tesouro.fetchQuotesBatch(tdToFetch)
      await this.storeQuotes(fetched, tdToAsset, today, liveQuotes)
    }

    return liveQuotes
  }

  private async storeQuotes(
    fetched: ReadonlyMap<string, number>,
    symbolToAsset: ReadonlyMap<string, string>,
    today: IsoDate,
    into: Map<string, number>,
  ): Promise<void> {
    const records: PriceRecord[] = []
    for (const [symbol, price] of fetched) {
      into.set(symbol, price)
      const assetTicker = symbolToAsset.get(symbol)
      if (assetTicker !== undefined)
        records.push({ assetId: assetTicker, date: today, close: price })
    }
    await this.priceHistory.upsertPrices(records)
  }

  private async tickersWithTransactions(): Promise<Set<string>> {
    const grouped = await this.db.transaction.groupBy({ by: ['assetId'] })
    return new Set(grouped.map((g) => g.assetId))
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

/** Chave usada para achar a cotação viva do ativo; null quando ele não tem cotação. */
function quoteKey(asset: Asset): string | null {
  if (asset.type === 'TESOURO_DIRETO') return resolveTesouroSymbol(asset.ticker, asset.yfTicker)
  if (asset.type !== null && NO_QUOTE_TYPES.has(asset.type as AssetType)) return null
  return resolveYfTicker(asset.ticker, asset.yfTicker)
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
