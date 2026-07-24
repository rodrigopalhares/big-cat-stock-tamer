import { describe, expect, it } from 'vitest'
import { type IsoDate, isoDate, toYearMonth } from '../shared/iso-date.js'
import type { TransactionData } from './calculation.js'
import { computePositionAtDate, generateMonthRange, monthEndPrice } from './evolution.js'

// Porte das partes puras de src/test/kotlin/com/stocks/service/MonthlyEvolutionServiceTest.kt

const tx = (
  type: 'BUY' | 'SELL',
  quantity: number,
  price: number,
  date: string,
): TransactionData => ({
  type,
  quantity,
  price,
  fees: 0,
  date: isoDate(date),
  priceBrl: price,
  feesBrl: 0,
})

describe('generateMonthRange', () => {
  it('mês único', () => {
    const range = generateMonthRange(toYearMonth('2024-01'), toYearMonth('2024-01'))
    expect(range).toEqual(['2024-01'])
  })

  it('vários meses', () => {
    const range = generateMonthRange(toYearMonth('2024-01'), toYearMonth('2024-04'))
    expect(range).toEqual(['2024-01', '2024-02', '2024-03', '2024-04'])
  })

  it('atravessa a virada do ano', () => {
    const range = generateMonthRange(toYearMonth('2024-11'), toYearMonth('2025-02'))
    expect(range).toEqual(['2024-11', '2024-12', '2025-01', '2025-02'])
  })

  it('fim anterior ao início devolve vazio', () => {
    expect(generateMonthRange(toYearMonth('2024-04'), toYearMonth('2024-01'))).toEqual([])
  })
})

describe('computePositionAtDate', () => {
  it('ignora transações posteriores à data', () => {
    const result = computePositionAtDate(
      [tx('BUY', 10, 10, '2024-01-15'), tx('BUY', 5, 20, '2024-03-10')],
      isoDate('2024-01-31'),
    )
    expect(result.quantity).toBeCloseTo(10, 3)
    expect(result.avgPrice).toBeCloseTo(10, 3)
  })

  it('inclui transações na própria data', () => {
    const result = computePositionAtDate(
      [tx('BUY', 10, 10, '2024-01-15'), tx('BUY', 10, 20, '2024-02-28')],
      isoDate('2024-02-29'),
    )
    expect(result.quantity).toBeCloseTo(20, 3)
    expect(result.avgPrice).toBeCloseTo(15, 3)
  })

  it('inclui transação exatamente na data de corte', () => {
    const result = computePositionAtDate([tx('BUY', 10, 10, '2024-02-29')], isoDate('2024-02-29'))
    expect(result.quantity).toBeCloseTo(10, 3)
  })

  it('sem transações até a data devolve posição zerada', () => {
    const result = computePositionAtDate([tx('BUY', 10, 10, '2024-05-01')], isoDate('2024-01-31'))
    expect(result.quantity).toBe(0)
    expect(result.avgPrice).toBe(0)
  })
})

describe('monthEndPrice', () => {
  const prices = (entries: Array<[string, number]>): Array<readonly [IsoDate, number]> =>
    entries.map(([d, p]) => [isoDate(d), p] as const)

  it('sem preços devolve null', () => {
    expect(monthEndPrice([], isoDate('2024-01-31'))).toBeNull()
  })

  it('usa o último preço até a data', () => {
    const result = monthEndPrice(
      prices([
        ['2024-01-10', 30],
        ['2024-01-25', 32],
        ['2024-01-31', 31],
      ]),
      isoDate('2024-01-31'),
    )
    expect(result).toBe(31)
  })

  it('ignora preços posteriores à data', () => {
    const result = monthEndPrice(
      prices([
        ['2024-01-25', 32],
        ['2024-02-05', 40],
      ]),
      isoDate('2024-01-31'),
    )
    expect(result).toBe(32)
  })

  it('devolve null quando todos os preços são posteriores', () => {
    expect(monthEndPrice(prices([['2024-02-05', 40]]), isoDate('2024-01-31'))).toBeNull()
  })
})
