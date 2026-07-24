import { compareDates, type IsoDate } from '../shared/iso-date.js'

/**
 * Regressão linear e retornos mensais — as funções puras do RiskMetricsService.
 * Porte do `companion object` de src/main/kotlin/com/stocks/service/RiskMetricsService.kt.
 */

export type RegressionResult = {
  readonly beta: number
  readonly alpha: number
  readonly rSquared: number
  readonly dataPoints: number
}

/** Abaixo disso a série não tem variação suficiente para uma regressão significar algo. */
const MIN_VARIANCE = 1e-12

/**
 * Mínimos quadrados de y sobre x.
 *
 * Null quando há menos de dois pontos, quando os tamanhos divergem, ou quando x não varia
 * (a reta seria vertical e o beta, infinito).
 */
export function linearRegression(
  x: readonly number[],
  y: readonly number[],
): RegressionResult | null {
  const n = x.length
  if (n < 2 || n !== y.length) return null

  const xMean = average(x)
  const yMean = average(y)

  let covXY = 0
  let varX = 0
  let varY = 0

  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - xMean
    const dy = (y[i] as number) - yMean
    covXY += dx * dy
    varX += dx * dx
    varY += dy * dy
  }

  if (varX < MIN_VARIANCE) return null

  const beta = covXY / varX
  return {
    beta,
    alpha: yMean - beta * xMean,
    rSquared: varY > MIN_VARIANCE ? (covXY * covXY) / (varX * varY) : 0,
    dataPoints: n,
  }
}

/**
 * Retorno de cada mês em relação ao anterior, a partir de uma série de preços.
 *
 * Só considera meses a partir de [cutoffDate]. O primeiro mês da série não tem retorno
 * (não há anterior), e meses cujo preço anterior é zero são pulados para não dividir por zero.
 */
export function computeMonthlyReturns(
  prices: ReadonlyMap<IsoDate, number>,
  cutoffDate: IsoDate,
): Map<IsoDate, number> {
  const sorted = [...prices.entries()]
    .filter(([date]) => date >= cutoffDate)
    .sort(([a], [b]) => compareDates(a, b))

  const returns = new Map<IsoDate, number>()
  if (sorted.length < 2) return returns

  for (let i = 1; i < sorted.length; i++) {
    const [, prev] = sorted[i - 1] as [IsoDate, number]
    const [date, curr] = sorted[i] as [IsoDate, number]
    if (prev > 0) returns.set(date, curr / prev - 1)
  }
  return returns
}

/** Converte uma taxa anual em mensal equivalente: `(1 + a)^(1/12) - 1`. */
export function annualToMonthlyRate(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1
}

/** Converte uma taxa mensal em anual equivalente: `(1 + m)^12 - 1`. */
export function monthlyToAnnualRate(monthly: number): number {
  return (1 + monthly) ** 12 - 1
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
