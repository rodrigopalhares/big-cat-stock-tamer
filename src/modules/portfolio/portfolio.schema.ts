import type { CashFlow } from '../../domain/xirr.js'
import type { IsoDate } from '../../shared/iso-date.js'

/** Porte de src/main/kotlin/com/stocks/dto/PortfolioDtos.kt. */

export type AssetPosition = {
  ticker: string
  name: string | null
  type: string
  quantity: number
  avgPrice: number
  avgPriceBrl: number
  totalCost: number
  totalCostBrl: number
  currentPrice: number | null
  /** Data do último preço gravado — o dashboard não busca cotação, então pode ser antiga. */
  priceDate: IsoDate | null
  currentPriceBrl: number | null
  currentValue: number | null
  unrealizedPnl: number | null
  realizedPnl: number
  realizedPnlBrl: number
  dividendPnl: number
  irr: number | null
  irrAnnual: number | null
  irrMonthly: number | null
  currency: string
  exchangeRate: number | null
  currentValueBrl: number | null
  unrealizedPnlBrl: number | null
  delisted: boolean
  allCashFlowsBrl: CashFlow[]
}

export type PortfolioSummary = {
  totalInvested: number
  /** Aporte líquido: só o dinheiro novo, sem provento nem venda reinvestidos. */
  netContribution: number
  currentValue: number | null
  realizedPnl: number
  unrealizedPnl: number | null
  dividendPnl: number
  irrAnnual: number | null
  irrMonthly: number | null
  positions: AssetPosition[]
}
