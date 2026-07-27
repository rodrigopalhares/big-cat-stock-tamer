import {
  type IsoDate,
  maxDate,
  minDate,
  monthsBetweenInclusive,
  type YearMonth,
  yearMonth,
} from '../shared/iso-date.js'
import { annualToMonthlyRate } from './regression.js'

/**
 * Séries dos gráficos do dashboard — funções puras.
 * Porte de `buildCdiChartLine` e `buildIbovChartLine`, privadas no PortfolioController.kt.
 *
 * As duas linhas de referência respondem à mesma pergunta: "e se esse dinheiro tivesse ido
 * para o benchmark?". Por isso ambas partem do primeiro mês com investimento e normalizam
 * por ele — antes disso não há capital aplicado e a comparação não significa nada, daí o
 * `null`.
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

/** Um provento já líquido e em reais, com a data e o tipo do ativo que o pagou. */
export type DividendFlow = { date: IsoDate; assetType: string; net: number }

export type MonthlyDividendSeries = {
  months: YearMonth[]
  datasets: Array<{ label: string; data: number[] }>
  /** Média móvel de `AVERAGE_WINDOW_MONTHS` meses, um ponto para cada mês do eixo. */
  movingAverage: number[]
}

/** Um ano é o ciclo natural: cobre os proventos anuais e as safras trimestrais. */
const AVERAGE_WINDOW_MONTHS = 12

/**
 * Proventos somados por mês e por tipo de ativo, para o gráfico de barras empilhadas.
 *
 * O eixo vai do primeiro provento até [currentMonth], preenchendo com zero todo mês sem
 * recebimento — tanto os buracos no meio quanto a cauda depois do último provento. Mês
 * vazio é informação, e omiti-lo faria o gráfico mentir sobre o espaçamento.
 */
export function buildMonthlyDividendSeries(
  flows: readonly DividendFlow[],
  currentMonth: YearMonth,
): MonthlyDividendSeries {
  const first = minDate(flows.map((f) => f.date))
  const last = maxDate(flows.map((f) => f.date))
  if (first === null || last === null) return { months: [], datasets: [], movingAverage: [] }

  // Provento lançado com data futura estica o eixo além do mês corrente.
  const lastMonth = maxYearMonth(currentMonth, yearMonth(last))
  const months = monthsBetweenInclusive(yearMonth(first), lastMonth)
  const indexOfMonth = new Map(months.map((month, index) => [month, index]))

  // Mesma ordem de legenda do gráfico de evolução: tipo de ativo em ordem alfabética.
  const datasets = [...new Set(flows.map((f) => f.assetType))]
    .sort()
    .map((label) => ({ label, data: months.map(() => 0) }))
  const dataByType = new Map(datasets.map((d) => [d.label, d.data]))

  for (const flow of flows) {
    const data = dataByType.get(flow.assetType)
    const index = indexOfMonth.get(yearMonth(flow.date))
    if (data === undefined || index === undefined) continue
    data[index] = (data[index] as number) + flow.net
  }

  const monthlyTotals = months.map((_, index) =>
    datasets.reduce((total, dataset) => total + (dataset.data[index] ?? 0), 0),
  )

  return { months, datasets, movingAverage: movingAverageOf(monthlyTotals) }
}

/**
 * Média móvel do total recebido: cada ponto é a média do próprio mês com os anteriores
 * dentro da janela.
 *
 * No começo do eixo a janela ainda não fechou, e aí a divisão é pelos meses que existem.
 * Dividir sempre por doze faria a linha subir em rampa no primeiro ano da carteira — uma
 * rampa que descreve a idade do histórico, não o que foi recebido.
 */
function movingAverageOf(monthlyTotals: readonly number[]): number[] {
  return monthlyTotals.map((_, index) => {
    const start = Math.max(0, index - AVERAGE_WINDOW_MONTHS + 1)
    const window = monthlyTotals.slice(start, index + 1)
    return window.reduce((total, value) => total + value, 0) / window.length
  })
}

function maxYearMonth(a: YearMonth, b: YearMonth): YearMonth {
  return a >= b ? a : b
}
