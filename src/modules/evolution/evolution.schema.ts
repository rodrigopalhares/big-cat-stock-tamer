import type { IsoDate } from '../../shared/iso-date.js'

/** Porte de src/main/kotlin/com/stocks/dto/MonthlyEvolutionDtos.kt. */

export type MonthlySnapshotView = {
  assetId: string
  month: IsoDate
  quantity: number
  avgPrice: number
  marketPrice: number
  totalCost: number
  marketValue: number
  accumulatedNetDividends: number
}

export type MonthlyEvolutionRow = {
  month: IsoDate
  snapshots: MonthlySnapshotView[]
  totalInvested: number
  totalMarketValue: number
  totalMonthlyNetDividends: number
  totalAccumulatedNetDividends: number
}

export type MonthlyEvolutionSummary = {
  months: MonthlyEvolutionRow[]
  tickers: string[]
}
