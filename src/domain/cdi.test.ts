import { describe, expect, it } from 'vitest'
import { isoDate } from '../shared/iso-date.js'
import { buildCdiChartLine, type CdiRate, simulateCdi } from './cdi.js'
import type { CashFlow } from './xirr.js'

/** Um dia útil por data, todos à mesma taxa — facilita conferir o composto na mão. */
function ratesFor(dates: readonly string[], rate: number): CdiRate[] {
  return dates.map((date) => ({ date: isoDate(date), rate }))
}

function flow(date: string, value: number): CashFlow {
  return { date: isoDate(date), value }
}

describe('simulateCdi', () => {
  const RATE = 0.001

  it('aporte único rende juro composto até a data', () => {
    const rates = ratesFor(['2024-01-01', '2024-01-02', '2024-01-03'], RATE)

    const { finalValue } = simulateCdi([flow('2024-01-01', -1000)], rates, isoDate('2024-01-03'))

    // Depositado no dia 1 e rendendo nos três dias.
    expect(finalValue).toBeCloseTo(1000 * 1.001 ** 3, 8)
  })

  it('o aporte do dia rende já no próprio dia', () => {
    const { finalValue } = simulateCdi(
      [flow('2024-01-01', -1000)],
      ratesFor(['2024-01-01'], RATE),
      isoDate('2024-01-01'),
    )

    expect(finalValue).toBeCloseTo(1001, 8)
  })

  it('aportes em datas diferentes rendem cada um a partir da sua', () => {
    const rates = ratesFor(['2024-01-01', '2024-01-02', '2024-01-03'], RATE)

    const { finalValue } = simulateCdi(
      [flow('2024-01-01', -1000), flow('2024-01-03', -500)],
      rates,
      isoDate('2024-01-03'),
    )

    expect(finalValue).toBeCloseTo(1000 * 1.001 ** 3 + 500 * 1.001, 8)
  })

  it('provento e venda sacam da conta', () => {
    const rates = ratesFor(['2024-01-01', '2024-01-02'], RATE)

    const { finalValue } = simulateCdi(
      [flow('2024-01-01', -1000), flow('2024-01-02', 300)],
      rates,
      isoDate('2024-01-02'),
    )

    // 1000 rende o dia 1; no dia 2 saem 300 antes do rendimento do dia.
    expect(finalValue).toBeCloseTo((1000 * 1.001 - 300) * 1.001, 8)
  })

  it('fim de semana não rende — só há taxa em dia útil', () => {
    // 06 e 07 de janeiro de 2024 são sábado e domingo, e não têm linha na série.
    const semana = ratesFor(['2024-01-05', '2024-01-08'], RATE)

    const sexta = simulateCdi([flow('2024-01-05', -1000)], semana, isoDate('2024-01-05'))
    const segunda = simulateCdi([flow('2024-01-05', -1000)], semana, isoDate('2024-01-08'))

    expect(sexta.finalValue).toBeCloseTo(1001, 8)
    // Dois dias úteis de rendimento atravessando o fim de semana, não quatro.
    expect(segunda.finalValue).toBeCloseTo(1000 * 1.001 ** 2, 8)
  })

  it('saldo para de render depois da última taxa conhecida', () => {
    const rates = ratesFor(['2024-01-01', '2024-01-02'], RATE)

    const { finalValue, lastRateDate } = simulateCdi(
      [flow('2024-01-01', -1000)],
      rates,
      isoDate('2024-06-30'),
    )

    expect(lastRateDate).toBe('2024-01-02')
    expect(finalValue).toBeCloseTo(1000 * 1.001 ** 2, 8)
  })

  it('fluxo posterior à última taxa entra no saldo sem render', () => {
    const { finalValue } = simulateCdi(
      [flow('2024-01-01', -1000), flow('2024-03-01', -500)],
      ratesFor(['2024-01-01'], RATE),
      isoDate('2024-06-30'),
    )

    expect(finalValue).toBeCloseTo(1001 + 500, 8)
  })

  it('ignora taxa posterior a asOf', () => {
    const rates = ratesFor(['2024-01-01', '2024-01-02', '2024-01-03'], RATE)

    const { finalValue } = simulateCdi([flow('2024-01-01', -1000)], rates, isoDate('2024-01-02'))

    expect(finalValue).toBeCloseTo(1000 * 1.001 ** 2, 8)
  })

  it('venda maior que o saldo deixa a conta negativa, e a dívida rende', () => {
    const rates = ratesFor(['2024-01-01', '2024-01-02'], RATE)

    const { finalValue } = simulateCdi(
      [flow('2024-01-01', -100), flow('2024-01-02', 500)],
      rates,
      isoDate('2024-01-02'),
    )

    expect(finalValue).toBeCloseTo((100 * 1.001 - 500) * 1.001, 8)
    expect(finalValue).toBeLessThan(0)
  })

  it('sem taxa nenhuma devolve só o caixa aportado', () => {
    const { finalValue, lastRateDate } = simulateCdi(
      [flow('2024-01-01', -1000)],
      [],
      isoDate('2024-01-31'),
    )

    expect(finalValue).toBe(1000)
    expect(lastRateDate).toBeNull()
  })

  it('sem fluxo nenhum o saldo é zero', () => {
    expect(simulateCdi([], ratesFor(['2024-01-01'], RATE), isoDate('2024-01-31')).finalValue).toBe(
      0,
    )
  })

  it('não depende da ordem de entrada de fluxos nem de taxas', () => {
    const rates = ratesFor(['2024-01-03', '2024-01-01', '2024-01-02'], RATE)
    const flows = [flow('2024-01-03', -500), flow('2024-01-01', -1000)]

    const { finalValue } = simulateCdi(flows, rates, isoDate('2024-01-03'))

    expect(finalValue).toBeCloseTo(1000 * 1.001 ** 3 + 500 * 1.001, 8)
  })
})

describe('buildCdiChartLine', () => {
  const RATE = 0.001

  it('devolve o saldo ao fim de cada mês do eixo', () => {
    const months = [isoDate('2024-01-31'), isoDate('2024-02-29')]
    const rates = ratesFor(['2024-01-15', '2024-02-15'], RATE)

    const line = buildCdiChartLine(months, [flow('2024-01-15', -1000)], rates)

    expect(line[0]).toBeCloseTo(1001, 8)
    expect(line[1]).toBeCloseTo(1000 * 1.001 ** 2, 8)
  })

  it('a varredura única bate com simular cada mês isoladamente', () => {
    const months = [isoDate('2024-01-31'), isoDate('2024-02-29'), isoDate('2024-03-31')]
    const rates = ratesFor(
      ['2024-01-10', '2024-01-20', '2024-02-10', '2024-03-05', '2024-03-25'],
      RATE,
    )
    const flows = [flow('2024-01-10', -1000), flow('2024-02-20', -700), flow('2024-03-05', 200)]

    expect(buildCdiChartLine(months, flows, rates)).toEqual(
      months.map((month) => simulateCdi(flows, rates, month).finalValue),
    )
  })

  it('mês anterior ao primeiro aporte fica sem ponto', () => {
    const months = [isoDate('2024-01-31'), isoDate('2024-02-29')]

    const line = buildCdiChartLine(
      months,
      [flow('2024-02-15', -1000)],
      ratesFor(['2024-02-15'], RATE),
    )

    expect(line[0]).toBeNull()
    expect(line[1]).toBeCloseTo(1001, 8)
  })

  it('sem taxa a linha inteira fica vazia', () => {
    const months = [isoDate('2024-01-31')]

    expect(buildCdiChartLine(months, [flow('2024-01-01', -1000)], [])).toEqual([null])
  })

  it('eixo vazio devolve lista vazia', () => {
    expect(
      buildCdiChartLine([], [flow('2024-01-01', -1000)], ratesFor(['2024-01-01'], 0.001)),
    ).toEqual([])
  })

  it('marcador é o primeiro dia do mês, mas o saldo é medido no último', () => {
    // O eixo do gráfico vem assim; medir no dia 1º perderia o mês inteiro de rendimento.
    const marcadores = [isoDate('2024-01-01')]
    const rates = ratesFor(['2024-01-10', '2024-01-25'], RATE)

    const line = buildCdiChartLine(marcadores, [flow('2024-01-10', -1000)], rates)

    expect(line[0]).toBeCloseTo(1000 * 1.001 ** 2, 8)
  })
})
