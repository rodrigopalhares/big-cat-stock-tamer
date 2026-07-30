import { describe, expect, it } from 'vitest'
import { type IsoDate, isoDate, toYearMonth } from '../shared/iso-date.js'
import {
  buildIbovChartLine,
  buildMonthlyDividendSeries,
  buildNetContributionChartLine,
  type DividendFlow,
} from './chart.js'

describe('buildNetContributionChartLine', () => {
  const months = ['2024-01-01', '2024-02-01', '2024-03-01'].map(isoDate)
  const flows = (entries: Array<[string, number]>) =>
    entries.map(([date, value]) => ({ date: isoDate(date), value }))

  it('meses vazios devolve vazio', () => {
    expect(buildNetContributionChartLine([], flows([['2024-01-10', -100]]))).toEqual([])
  })

  it('sem fluxo nenhum a linha fica zerada', () => {
    expect(buildNetContributionChartLine(months, [])).toEqual([0, 0, 0])
  })

  it('acumula as compras mês a mês', () => {
    const line = buildNetContributionChartLine(
      months,
      flows([
        ['2024-01-10', -100],
        ['2024-02-10', -50],
        ['2024-03-10', -25],
      ]),
    )

    expect(line).toEqual([100, 150, 175])
  })

  it('mês sem fluxo repete o acumulado, não volta a zero', () => {
    const line = buildNetContributionChartLine(months, flows([['2024-01-10', -100]]))

    expect(line).toEqual([100, 100, 100])
  })

  it('compra paga com provento não levanta a linha', () => {
    const line = buildNetContributionChartLine(
      months,
      flows([
        ['2024-01-10', -100],
        ['2024-02-05', 30],
        ['2024-02-20', -30],
      ]),
    )

    expect(line).toEqual([100, 100, 100])
  })

  it('conta só a parte da compra que o caixa não cobriu', () => {
    const line = buildNetContributionChartLine(
      months,
      flows([
        ['2024-01-10', -100],
        ['2024-02-05', 30],
        ['2024-02-20', -50],
      ]),
    )

    expect(line).toEqual([100, 120, 120])
  })

  it('fluxo posterior ao último mês do eixo fica de fora', () => {
    const line = buildNetContributionChartLine(
      months,
      flows([
        ['2024-01-10', -100],
        ['2024-04-10', -900],
      ]),
    )

    expect(line).toEqual([100, 100, 100])
  })

  it('fluxo no último dia do mês entra naquele mês', () => {
    const line = buildNetContributionChartLine(
      months,
      flows([
        ['2024-01-31', -100],
        // 2024 é bissexto: fevereiro tem 29 dias.
        ['2024-02-29', -50],
      ]),
    )

    expect(line).toEqual([100, 150, 150])
  })

  it('fluxos fora de ordem não confundem a varredura', () => {
    const line = buildNetContributionChartLine(
      months,
      flows([
        ['2024-03-10', -25],
        ['2024-01-10', -100],
        ['2024-02-10', -50],
      ]),
    )

    expect(line).toEqual([100, 150, 175])
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

describe('buildMonthlyDividendSeries', () => {
  const flow = (date: string, assetType: string, net: number): DividendFlow => ({
    date: isoDate(date),
    assetType,
    net,
  })
  const month = (value: string) => toYearMonth(value)

  it('sem proventos devolve vazio', () => {
    expect(buildMonthlyDividendSeries([], month('2024-06'))).toEqual({
      months: [],
      datasets: [],
      movingAverage: [],
    })
  })

  it('soma os proventos do mesmo mês e tipo de ativo', () => {
    const series = buildMonthlyDividendSeries(
      [
        flow('2024-01-10', 'STOCK', 100),
        flow('2024-01-25', 'STOCK', 50),
        flow('2024-01-15', 'REIT', 30),
      ],
      month('2024-01'),
    )

    expect(series.months).toEqual(['2024-01'])
    expect(series.datasets).toEqual([
      { label: 'REIT', data: [30] },
      { label: 'STOCK', data: [150] },
    ])
  })

  it('preenche com zero o mês sem provento entre o primeiro e o último', () => {
    const series = buildMonthlyDividendSeries(
      [flow('2024-01-10', 'STOCK', 100), flow('2024-03-10', 'STOCK', 80)],
      month('2024-03'),
    )

    expect(series.months).toEqual(['2024-01', '2024-02', '2024-03'])
    expect(series.datasets).toEqual([{ label: 'STOCK', data: [100, 0, 80] }])
  })

  it('cada tipo de ativo vira uma série com um ponto por mês', () => {
    const series = buildMonthlyDividendSeries(
      [flow('2024-01-10', 'STOCK', 100), flow('2024-02-10', 'REIT', 40)],
      month('2024-02'),
    )

    // Tipos em ordem alfabética, como no gráfico de evolução.
    expect(series.datasets).toEqual([
      { label: 'REIT', data: [0, 40] },
      { label: 'STOCK', data: [100, 0] },
    ])
  })

  it('atravessa a virada do ano sem furo no eixo', () => {
    const series = buildMonthlyDividendSeries(
      [flow('2023-11-10', 'ETF', 10), flow('2024-02-10', 'ETF', 20)],
      month('2024-02'),
    )

    expect(series.months).toEqual(['2023-11', '2023-12', '2024-01', '2024-02'])
    expect(series.datasets).toEqual([{ label: 'ETF', data: [10, 0, 0, 20] }])
  })

  it('estica o eixo até o mês corrente mesmo sem provento recente', () => {
    const series = buildMonthlyDividendSeries([flow('2024-01-10', 'STOCK', 90)], month('2024-04'))

    expect(series.months).toEqual(['2024-01', '2024-02', '2024-03', '2024-04'])
    expect(series.datasets).toEqual([{ label: 'STOCK', data: [90, 0, 0, 0] }])
  })

  it('provento com data futura estica o eixo além do mês corrente', () => {
    const series = buildMonthlyDividendSeries(
      [flow('2024-01-10', 'STOCK', 90), flow('2024-05-10', 'STOCK', 10)],
      month('2024-03'),
    )

    expect(series.months).toEqual(['2024-01', '2024-02', '2024-03', '2024-04', '2024-05'])
  })

  describe('média móvel', () => {
    it('tem um ponto para cada mês do eixo', () => {
      const series = buildMonthlyDividendSeries([flow('2024-01-10', 'STOCK', 90)], month('2024-04'))

      expect(series.movingAverage).toHaveLength(series.months.length)
    })

    it('recebimento constante dá uma linha constante', () => {
      const flows = Array.from({ length: 12 }, (_, index) =>
        flow(`2024-${String(index + 1).padStart(2, '0')}-10`, 'STOCK', 120),
      )

      const series = buildMonthlyDividendSeries(flows, month('2024-12'))

      // Janela parcial ou cheia, a média de meses iguais é o próprio valor.
      expect(series.movingAverage.every((value) => Math.abs(value - 120) < 1e-6)).toBe(true)
    })

    it('no começo do eixo divide pelos meses que existem', () => {
      const series = buildMonthlyDividendSeries(
        [flow('2024-01-10', 'STOCK', 100), flow('2024-03-10', 'STOCK', 50)],
        month('2024-03'),
      )

      // 100/1, 100/2, 150/3 — dividir por doze daria uma rampa que só descreve a idade
      // do histórico.
      expect(series.movingAverage).toEqual([100, 50, 50])
    })

    it('a janela solta o mês que saiu dos últimos doze', () => {
      const series = buildMonthlyDividendSeries(
        [flow('2024-01-10', 'STOCK', 1200)],
        month('2025-06'),
      )

      expect(series.movingAverage[0]).toBeCloseTo(1200, 6)
      // 2024-12 ainda enxerga o recebimento; 2025-01 já não.
      expect(series.movingAverage[11]).toBeCloseTo(100, 6)
      expect(series.movingAverage[12]).toBe(0)
      expect(series.movingAverage.at(-1)).toBe(0)
    })

    it('soma todos os tipos do mês, não só um', () => {
      const series = buildMonthlyDividendSeries(
        [flow('2024-01-10', 'STOCK', 30), flow('2024-01-10', 'REIT', 30)],
        month('2024-02'),
      )

      expect(series.movingAverage).toEqual([60, 30])
    })
  })
})
