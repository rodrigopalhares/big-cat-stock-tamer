import { describe, expect, it } from 'vitest'
import { type IsoDate, isoDate } from '../shared/iso-date.js'
import {
  annualToMonthlyRate,
  computeMonthlyReturns,
  linearRegression,
  monthlyToAnnualRate,
} from './regression.js'

// Porte de src/test/kotlin/com/stocks/service/RiskMetricsServiceTest.kt

describe('linearRegression', () => {
  it('correlação positiva perfeita (y = 2x)', () => {
    const result = linearRegression([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
    expect(result).not.toBeNull()
    expect(result?.beta).toBeCloseTo(2, 3)
    expect(result?.alpha).toBeCloseTo(0, 3)
    expect(result?.rSquared).toBeCloseTo(1, 3)
    expect(result?.dataPoints).toBe(5)
  })

  it('com intercepto (y = 2x + 1)', () => {
    const result = linearRegression([1, 2, 3, 4, 5], [3, 5, 7, 9, 11])
    expect(result?.beta).toBeCloseTo(2, 3)
    expect(result?.alpha).toBeCloseTo(1, 3)
    expect(result?.rSquared).toBeCloseTo(1, 3)
  })

  it('sem correlação (y constante)', () => {
    const result = linearRegression([1, 2, 3, 4, 5], [5, 5, 5, 5, 5])
    expect(result?.beta).toBeCloseTo(0, 3)
    expect(result?.rSquared).toBeCloseTo(0, 3)
  })

  it('dados insuficientes', () => {
    expect(linearRegression([1], [2])).toBeNull()
  })

  it('dados vazios', () => {
    expect(linearRegression([], [])).toBeNull()
  })

  it('variância zero em x', () => {
    expect(linearRegression([3, 3, 3], [1, 2, 3])).toBeNull()
  })

  it('tamanhos diferentes', () => {
    expect(linearRegression([1, 2, 3], [1, 2])).toBeNull()
  })

  it('correlação negativa (y = -2x + 12)', () => {
    const result = linearRegression([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])
    expect(result?.beta).toBeCloseTo(-2, 3)
    expect(result?.rSquared).toBeCloseTo(1, 3)
  })

  it('correlação parcial com ruído', () => {
    const result = linearRegression([1, 2, 3, 4, 5], [2.1, 3.8, 6.2, 7.9, 10.1])
    expect(result?.beta).toBeCloseTo(1.99, 1)
    expect(result?.rSquared as number).toBeGreaterThan(0.99)
    expect(result?.dataPoints).toBe(5)
  })
})

describe('computeMonthlyReturns', () => {
  const prices = (entries: Array<[string, number]>): Map<IsoDate, number> =>
    new Map(entries.map(([d, v]) => [isoDate(d), v]))

  it('calcula o retorno mês a mês', () => {
    const returns = computeMonthlyReturns(
      prices([
        ['2024-01-01', 100],
        ['2024-02-01', 110],
        ['2024-03-01', 105],
      ]),
      isoDate('2024-01-01'),
    )

    expect(returns.size).toBe(2)
    expect(returns.get(isoDate('2024-02-01'))).toBeCloseTo(0.1, 3)
    expect(returns.get(isoDate('2024-03-01'))).toBeCloseTo(-0.04545, 3)
  })

  it('cutoff descarta dados anteriores', () => {
    const returns = computeMonthlyReturns(
      prices([
        ['2023-12-01', 90],
        ['2024-01-01', 100],
        ['2024-02-01', 110],
      ]),
      isoDate('2024-01-01'),
    )

    expect(returns.size).toBe(1)
    expect(returns.get(isoDate('2024-02-01'))).toBeCloseTo(0.1, 3)
  })

  it('preço único não gera retorno', () => {
    const returns = computeMonthlyReturns(prices([['2024-01-01', 100]]), isoDate('2024-01-01'))
    expect(returns.size).toBe(0)
  })

  it('série vazia', () => {
    expect(computeMonthlyReturns(new Map(), isoDate('2024-01-01')).size).toBe(0)
  })

  it('pula mês cujo preço anterior é zero', () => {
    const returns = computeMonthlyReturns(
      prices([
        ['2024-01-01', 0],
        ['2024-02-01', 100],
      ]),
      isoDate('2024-01-01'),
    )
    expect(returns.size).toBe(0)
  })

  it('ordena antes de calcular, mesmo com entrada fora de ordem', () => {
    const returns = computeMonthlyReturns(
      prices([
        ['2024-03-01', 105],
        ['2024-01-01', 100],
        ['2024-02-01', 110],
      ]),
      isoDate('2024-01-01'),
    )
    expect(returns.get(isoDate('2024-02-01'))).toBeCloseTo(0.1, 3)
    expect(returns.get(isoDate('2024-03-01'))).toBeCloseTo(-0.04545, 3)
  })
})

describe('conversão de taxas', () => {
  it('anual para mensal e de volta é identidade', () => {
    expect(monthlyToAnnualRate(annualToMonthlyRate(0.1425))).toBeCloseTo(0.1425, 10)
  })

  it('12% ao ano dá aproximadamente 0,949% ao mês', () => {
    expect(annualToMonthlyRate(0.12)).toBeCloseTo(0.00949, 5)
  })
})
