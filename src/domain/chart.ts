import type { IsoDate } from '../shared/iso-date.js'
import { annualToMonthlyRate } from './regression.js'

/**
 * Linhas de referência do gráfico do dashboard — funções puras.
 * Porte de `buildCdiChartLine` e `buildIbovChartLine`, privadas no PortfolioController.kt.
 *
 * As duas respondem à mesma pergunta: "e se esse dinheiro tivesse ido para o benchmark?".
 * Por isso ambas partem do primeiro mês com investimento e normalizam por ele — antes disso
 * não há capital aplicado e a comparação não significa nada, daí o `null`.
 */

/** Rende o valor inicial ao CDI, mês a mês, a partir do primeiro mês investido. */
export function buildCdiChartLine(
  investedLine: readonly number[],
  cdiAnnual: number | null,
): Array<number | null> {
  if (investedLine.length === 0) return []
  if (cdiAnnual === null) return investedLine.map(() => null)

  const firstIndex = investedLine.findIndex((value) => value > 0)
  if (firstIndex < 0) return investedLine.map(() => null)

  const cdiMonthly = annualToMonthlyRate(cdiAnnual)
  const firstInvested = investedLine[firstIndex] as number

  return investedLine.map((_, index) =>
    index < firstIndex ? null : firstInvested * (1 + cdiMonthly) ** (index - firstIndex),
  )
}

/** Aplica a variação do Ibovespa sobre o valor inicial investido. */
export function buildIbovChartLine(
  months: readonly IsoDate[],
  investedLine: readonly number[],
  ibovPrices: ReadonlyMap<IsoDate, number>,
): Array<number | null> {
  if (months.length === 0 || investedLine.length === 0) return []
  if (ibovPrices.size === 0) return months.map(() => null)

  const firstIndex = investedLine.findIndex((value) => value > 0)
  if (firstIndex < 0) return months.map(() => null)

  const firstMonth = months[firstIndex]
  const ibovAtStart = firstMonth === undefined ? undefined : ibovPrices.get(firstMonth)
  if (ibovAtStart === undefined) return months.map(() => null)

  const firstInvested = investedLine[firstIndex] as number

  return months.map((month, index) => {
    if (index < firstIndex) return null
    const price = ibovPrices.get(month)
    return price === undefined ? null : firstInvested * (price / ibovAtStart)
  })
}
