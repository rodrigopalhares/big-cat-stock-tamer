import type { IsoDate, YearMonth } from '../shared/iso-date.js'
import { monthsBetweenInclusive } from '../shared/iso-date.js'
import { calculatePosition, type PositionCalcResult, type TransactionData } from './calculation.js'

/**
 * Funções puras da evolução mensal da carteira.
 * Porte das partes sem I/O de src/main/kotlin/com/stocks/service/MonthlyEvolutionService.kt.
 */

/** Meses de [start] a [end], inclusive nas duas pontas. */
export function generateMonthRange(start: YearMonth, end: YearMonth): YearMonth[] {
  return monthsBetweenInclusive(start, end)
}

/** Posição consolidada considerando apenas as transações até [date], inclusive. */
export function computePositionAtDate(
  transactions: readonly TransactionData[],
  date: IsoDate,
): PositionCalcResult {
  return calculatePosition(transactions.filter((t) => t.date <= date))
}

/** Último preço registrado até [monthEnd], inclusive. Null quando não há preço no período. */
export function monthEndPrice(
  prices: readonly (readonly [IsoDate, number])[],
  monthEnd: IsoDate,
): number | null {
  let best: readonly [IsoDate, number] | null = null
  for (const entry of prices) {
    if (entry[0] > monthEnd) continue
    if (best === null || entry[0] > best[0]) best = entry
  }
  return best?.[1] ?? null
}
