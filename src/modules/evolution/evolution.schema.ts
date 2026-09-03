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
  /** Todo ticker que já teve snapshot. */
  tickers: string[]
  /**
   * Só quem tem quantidade no mês mais recente — as colunas da tabela de Evolução. Papel
   * vendido há anos continua nos totais, mas não ganha uma coluna de traços.
   */
  currentTickers: string[]
}
