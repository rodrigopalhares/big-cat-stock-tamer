import { describe, expect, it } from 'vitest'
import { type IsoDate, isoDate } from '../shared/iso-date.js'
import { buildCdiChartLine, buildIbovChartLine } from './chart.js'

describe('buildCdiChartLine', () => {
  it('série vazia devolve vazio', () => {
    expect(buildCdiChartLine([], 0.1)).toEqual([])
  })

  it('sem CDI devolve tudo nulo', () => {
    expect(buildCdiChartLine([100, 200], null)).toEqual([null, null])
  })

  it('sem investimento devolve tudo nulo', () => {
    expect(buildCdiChartLine([0, 0], 0.1)).toEqual([null, null])
  })

  it('rende a partir do primeiro mês investido', () => {
    const line = buildCdiChartLine([0, 100, 100, 100], 0.12)

    expect(line[0]).toBeNull()
    expect(line[1]).toBeCloseTo(100, 6)
    // 12% a.a. ≈ 0,949% a.m.
    expect(line[2] as number).toBeCloseTo(100 * 1.00949, 3)
    expect(line[3] as number).toBeGreaterThan(line[2] as number)
  })

  it('CDI zero mantém o valor constante', () => {
    expect(buildCdiChartLine([100, 100, 100], 0)).toEqual([100, 100, 100])
  })
})

describe('buildIbovChartLine', () => {
  const months = ['2024-01-01', '2024-02-01', '2024-03-01'].map(isoDate)
  const prices = (entries: Array<[string, number]>): Map<IsoDate, number> =>
    new Map(entries.map(([d, v]) => [isoDate(d), v]))

  it('meses vazios devolve vazio', () => {
    expect(buildIbovChartLine([], [], prices([]))).toEqual([])
  })

  it('sem preços do IBOV devolve tudo nulo', () => {
    expect(buildIbovChartLine(months, [100, 100, 100], prices([]))).toEqual([null, null, null])
  })

  it('sem investimento devolve tudo nulo', () => {
    expect(buildIbovChartLine(months, [0, 0, 0], prices([['2024-01-01', 120000]]))).toEqual([
      null,
      null,
      null,
    ])
  })

  it('aplica a variação do índice sobre o valor investido', () => {
    const line = buildIbovChartLine(
      months,
      [100, 100, 100],
      prices([
        ['2024-01-01', 100000],
        ['2024-02-01', 110000],
        ['2024-03-01', 90000],
      ]),
    )

    expect(line[0]).toBeCloseTo(100, 6)
    expect(line[1]).toBeCloseTo(110, 6)
    expect(line[2]).toBeCloseTo(90, 6)
  })

  it('mês sem preço do índice fica nulo, sem quebrar os demais', () => {
    const line = buildIbovChartLine(
      months,
      [100, 100, 100],
      prices([
        ['2024-01-01', 100000],
        ['2024-03-01', 120000],
      ]),
    )

    expect(line[1]).toBeNull()
    expect(line[2]).toBeCloseTo(120, 6)
  })

  it('meses anteriores ao primeiro investimento ficam nulos', () => {
    const line = buildIbovChartLine(
      months,
      [0, 100, 100],
      prices([
        ['2024-01-01', 100000],
        ['2024-02-01', 100000],
        ['2024-03-01', 110000],
      ]),
    )

    expect(line[0]).toBeNull()
    expect(line[1]).toBeCloseTo(100, 6)
    expect(line[2]).toBeCloseTo(110, 6)
  })

  it('sem preço do índice no mês inicial devolve tudo nulo', () => {
    expect(buildIbovChartLine(months, [100, 100, 100], prices([['2024-02-01', 110000]]))).toEqual([
      null,
      null,
      null,
    ])
  })
})
