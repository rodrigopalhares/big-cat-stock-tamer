import { type IsoDate, lastDayOf, yearMonth } from '../shared/iso-date.js'
import type { CashFlow } from './xirr.js'

/**
 * Carteira-sombra no CDI — funções puras, sem I/O.
 *
 * Responde "e se esse dinheiro tivesse ficado no CDI?" aplicando os *mesmos* fluxos de
 * caixa da carteira numa conta que rende CDI diário. Comparar assim, e não a TIR contra o
 * CDI nominal do período, é o que neutraliza a irregularidade dos aportes: o cronograma é
 * idêntico dos dois lados, então a diferença que sobra é escolha de ativo, não de timing.
 *
 * Convenção de sinal herdada de `calculation.ts`: compra é fluxo negativo (dinheiro saindo
 * do bolso) e venda ou provento é positivo. Na sombra o sinal inverte — a compra é o
 * depósito na conta do CDI, o provento é o saque.
 */

/** Uma taxa diária do CDI, como fração ao dia. */
export type CdiRate = {
  readonly date: IsoDate
  readonly rate: number
}

export type CdiSimulation = {
  /** Saldo da conta hipotética em `asOf`. */
  readonly finalValue: number
  /** Último dia com taxa conhecida; a simulação não rende depois dele. */
  readonly lastRateDate: IsoDate | null
}

/**
 * Faz os fluxos renderem CDI até `asOf`.
 *
 * O saldo pode ficar negativo — quem vendeu mais do que a conta tinha fica devendo, e a
 * dívida rende à mesma taxa. É o espelho fiel da carteira, que também pode ter realizado
 * mais do que aportou.
 *
 * A partir do último dia com taxa o saldo fica parado, e `lastRateDate` diz até onde a
 * conta foi de fato. Série defasada rende menos e faz a carteira parecer melhor do que é,
 * então quem exibe o número precisa exibir também a data.
 */
export function simulateCdi(
  cashFlows: readonly CashFlow[],
  rates: readonly CdiRate[],
  asOf: IsoDate,
): CdiSimulation {
  const sorted = sortedByDate(rates)

  return {
    finalValue: walkBalances(sortedByDate(cashFlows), sorted, [asOf])[0] as number,
    lastRateDate: sorted[sorted.length - 1]?.date ?? null,
  }
}

/**
 * O saldo da sombra ao fim de cada mês do eixo, para a linha do gráfico.
 *
 * Não normaliza nada: é valor absoluto em reais, na mesma escala do patrimônio e da linha
 * de aporte líquido. Diferente da linha do IBOVESPA, que projeta o investido inicial pela
 * variação do índice e portanto responde "aporte único no começo" — aqui o cronograma de
 * aportes é o real. As duas linhas não respondem à mesma pergunta.
 *
 * `months` são os marcadores do eixo, que vêm como o primeiro dia de cada mês; o saldo é
 * medido no *fim* do mês, como em `buildNetContributionChartLine`.
 */
export function buildCdiChartLine(
  months: readonly IsoDate[],
  cashFlows: readonly CashFlow[],
  rates: readonly CdiRate[],
): Array<number | null> {
  if (months.length === 0) return []
  if (rates.length === 0) return months.map(() => null)

  const monthEnds = months.map((month) => lastDayOf(yearMonth(month)))

  // Antes do primeiro aporte a conta está vazia, e um zero na linha sugeriria perda total.
  return walkBalances(sortedByDate(cashFlows), sortedByDate(rates), monthEnds).map((balance) =>
    balance === 0 ? null : balance,
  )
}

/**
 * Uma varredura só, devolvendo o saldo em cada data de `checkpoints`.
 *
 * Exige as três listas em ordem crescente: como as datas só avançam, nenhum dos ponteiros
 * volta, e a série inteira é percorrida uma vez em vez de uma vez por checkpoint.
 *
 * Os fluxos do dia entram *antes* do rendimento: dinheiro depositado hoje rende hoje.
 */
function walkBalances(
  flows: readonly CashFlow[],
  rates: readonly CdiRate[],
  checkpoints: readonly IsoDate[],
): number[] {
  let balance = 0
  let flowIndex = 0
  let rateIndex = 0

  const applyFlowsUpTo = (limit: IsoDate) => {
    while (flowIndex < flows.length && (flows[flowIndex] as CashFlow).date <= limit) {
      balance -= (flows[flowIndex] as CashFlow).value
      flowIndex += 1
    }
  }

  return checkpoints.map((checkpoint) => {
    while (rateIndex < rates.length && (rates[rateIndex] as CdiRate).date <= checkpoint) {
      const { date, rate } = rates[rateIndex] as CdiRate
      applyFlowsUpTo(date)
      balance *= 1 + rate
      rateIndex += 1
    }
    // Fluxo posterior à última taxa aplicada ainda entra no saldo, só não rende ainda.
    applyFlowsUpTo(checkpoint)
    return balance
  })
}

function sortedByDate<T extends { readonly date: IsoDate }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
