import { compareDates, type IsoDate, today } from '../shared/iso-date.js'
import { transactionTypeMeta } from '../shared/transaction-types.js'
import type { TransactionType } from './constants.js'
import { type CashFlow, computeIrr, xirr } from './xirr.js'

/**
 * Cálculo de posição, preço médio, resultado realizado e fluxo de caixa.
 * Porte de src/main/kotlin/com/stocks/service/CalculationService.kt.
 *
 * Puro e síncrono: sem banco, sem rede, sem relógio (a data "hoje" entra por parâmetro).
 */

export type TransactionData = {
  /**
   * Manda no cálculo: decide direção, efeito no custo e se gera fluxo de caixa —
   * ver `src/shared/transaction-types.ts`. O sinal de `quantity` apenas o acompanha.
   */
  readonly type: TransactionType
  readonly quantity: number
  readonly price: number
  readonly fees: number
  readonly date: IsoDate
  readonly priceBrl: number
  readonly feesBrl: number
}

export type PositionCalcResult = {
  readonly quantity: number
  readonly avgPrice: number
  readonly totalCost: number
  readonly realizedPnl: number
  readonly cashFlows: readonly CashFlow[]
  readonly totalCostBrl: number
  readonly realizedPnlBrl: number
  readonly cashFlowsBrl: readonly CashFlow[]
  readonly avgPriceBrl: number
}

export type CashFlowsResult = {
  readonly cashFlows: readonly CashFlow[]
  readonly cashFlowsBrl: readonly CashFlow[]
}

/** Abaixo disso a posição é considerada zerada — evita resíduo de ponto flutuante. */
const QUANTITY_EPSILON = 1e-8

export function calculatePosition(transactions: readonly TransactionData[]): PositionCalcResult {
  let quantity = 0
  let accumulatedCost = 0
  let realizedPnl = 0
  const cashFlows: CashFlow[] = []

  let accumulatedCostBrl = 0
  let realizedPnlBrl = 0
  const cashFlowsBrl: CashFlow[] = []

  for (const t of sortedByDate(transactions)) {
    const meta = transactionTypeMeta(t.type)
    const absQty = Math.abs(t.quantity)

    if (meta.costEffect === 'RETURN_OF_CAPITAL') {
      // Devolução de capital: entra dinheiro, o custo cai e a quantidade fica igual.
      if (quantity <= 0) continue

      const returned = absQty * t.price - t.fees
      const returnedBrl = absQty * t.priceBrl - t.feesBrl

      // Devolveram mais do que custou: o custo para em zero e a sobra vira ganho.
      realizedPnl += Math.max(0, returned - accumulatedCost)
      realizedPnlBrl += Math.max(0, returnedBrl - accumulatedCostBrl)
      accumulatedCost = Math.max(0, accumulatedCost - returned)
      accumulatedCostBrl = Math.max(0, accumulatedCostBrl - returnedBrl)

      cashFlows.push({ date: t.date, value: returned })
      cashFlowsBrl.push({ date: t.date, value: returnedBrl })
      continue
    }

    if (meta.sign > 0) {
      // Compra, bonificação e desdobramento — aumentam a posição.
      quantity += absQty

      if (meta.costEffect !== 'NONE') {
        // MARKET soma a corretagem ao custo; FIXED_PRICE entra ao custo atribuído, sem taxas.
        const cost = absQty * t.price + t.fees
        const costBrl = absQty * t.priceBrl + t.feesBrl
        accumulatedCost += cost
        accumulatedCostBrl += costBrl

        if (meta.cashFlow) {
          cashFlows.push({ date: t.date, value: -cost })
          cashFlowsBrl.push({ date: t.date, value: -costBrl })
        }
      }
      continue
    }

    // Reduzir sem posição não faz nada — vale para venda e para agrupamento.
    if (quantity <= 0) continue

    if (meta.costEffect === 'MARKET') {
      // Venda: baixa o custo pelo preço médio e realiza o resultado.
      const avgPrice = accumulatedCost / quantity
      const avgPriceBrl = accumulatedCostBrl / quantity

      const saleProceeds = absQty * t.price - t.fees
      const costOfSold = avgPrice * absQty
      realizedPnl += saleProceeds - costOfSold
      accumulatedCost -= costOfSold

      const saleProceedsBrl = absQty * t.priceBrl - t.feesBrl
      const costOfSoldBrl = avgPriceBrl * absQty
      realizedPnlBrl += saleProceedsBrl - costOfSoldBrl
      accumulatedCostBrl -= costOfSoldBrl

      if (meta.cashFlow) {
        cashFlows.push({ date: t.date, value: saleProceeds })
        cashFlowsBrl.push({ date: t.date, value: saleProceedsBrl })
      }
    }
    // Agrupamento (`NONE`): o custo total fica de pé sobre menos ações — o preço médio sobe.

    quantity -= absQty
  }

  if (quantity < QUANTITY_EPSILON) quantity = 0

  return {
    quantity,
    avgPrice: quantity > 0 ? accumulatedCost / quantity : 0,
    totalCost: accumulatedCost,
    realizedPnl,
    cashFlows,
    totalCostBrl: accumulatedCostBrl,
    realizedPnlBrl,
    cashFlowsBrl,
    avgPriceBrl: quantity > 0 ? accumulatedCostBrl / quantity : 0,
  }
}

/** Só os fluxos de caixa, sem o resto da posição. */
export function buildCashFlows(transactions: readonly TransactionData[]): CashFlowsResult {
  const { cashFlows, cashFlowsBrl } = calculatePosition(transactions)
  return { cashFlows, cashFlowsBrl }
}

export function calculateUnrealizedPnl(
  quantity: number,
  avgPrice: number,
  currentPrice: number,
): number {
  return (currentPrice - avgPrice) * quantity
}

/** Um passo da caminhada do aporte: o total já aportado logo depois daquele fluxo. */
export type NetContributionPoint = {
  readonly date: IsoDate
  readonly contributed: number
}

/**
 * Dinheiro novo que saiu do bolso — o aporte líquido, passo a passo.
 *
 * Percorre os fluxos em ordem mantendo um caixa da própria carteira: venda, provento e
 * redução de capital entram nele; compra saca dele primeiro e só o que faltar conta como
 * aporte. Assim provento reinvestido e lucro de venda reaplicado não inflam o número —
 * dinheiro que já estava dentro da carteira não é aporte novo.
 *
 * O caixa nunca é sacado, porque não existe registro de retirada: quem vendeu e levou o
 * dinheiro embora aparece com o mesmo aporte de quem deixou parado na corretora. É o
 * limite do modelo, e ele erra para menos, nunca para mais.
 *
 * No mesmo dia a entrada vem antes da saída — a venda da manhã financia a compra da tarde.
 *
 * Devolve a caminhada inteira, e não só o total, porque a linha do gráfico de evolução
 * precisa do acumulado em cada mês. Uma passada só: refazer a conta por mês daria o mesmo
 * número com custo quadrático.
 */
export function walkNetContribution(
  cashFlows: readonly CashFlow[],
): readonly NetContributionPoint[] {
  let cash = 0
  let contributed = 0
  const points: NetContributionPoint[] = []

  for (const flow of inflowsFirst(cashFlows)) {
    if (flow.value >= 0) {
      cash += flow.value
    } else {
      const needed = -flow.value
      const fromCash = Math.min(cash, needed)
      cash -= fromCash
      contributed += needed - fromCash
    }
    points.push({ date: flow.date, contributed })
  }

  return points
}

/** O aporte líquido do fim da caminhada: o total que saiu do bolso. */
export function calculateNetContribution(cashFlows: readonly CashFlow[]): number {
  return walkNetContribution(cashFlows).at(-1)?.contributed ?? 0
}

/** IRR tratando os fluxos como períodos consecutivos. Null quando não há dados suficientes. */
export function calculateIrr(
  cashFlows: readonly CashFlow[],
  currentValue?: number | null,
): number | null {
  if (cashFlows.length === 0) return null

  const values = cashFlows.map((f) => f.value)
  if (currentValue != null && currentValue > 0) values.push(currentValue)
  if (values.length < 2) return null

  const irr = computeIrr(values)
  return Number.isFinite(irr) ? irr : null
}

/**
 * XIRR, considerando a data real de cada fluxo.
 *
 * Null quando não há fluxo suficiente ou quando todos têm o mesmo sinal — sem investimento
 * e retorno não existe taxa. [asOf] é a data atribuída ao [currentValue]; explícita para
 * a função continuar pura e determinística em teste.
 */
export function calculateXirr(
  cashFlows: readonly CashFlow[],
  currentValue?: number | null,
  asOf: IsoDate = today(),
): number | null {
  if (cashFlows.length === 0) return null

  const flows: CashFlow[] = [...cashFlows]
  if (currentValue != null && currentValue > 0) flows.push({ date: asOf, value: currentValue })
  if (flows.length < 2) return null

  const hasNegative = flows.some((f) => f.value < 0)
  const hasPositive = flows.some((f) => f.value > 0)
  if (!hasNegative || !hasPositive) return null

  return xirr(flows)
}

function sortedByDate(transactions: readonly TransactionData[]): TransactionData[] {
  return [...transactions].sort((a, b) => compareDates(a.date, b.date))
}

function inflowsFirst(cashFlows: readonly CashFlow[]): CashFlow[] {
  return [...cashFlows].sort((a, b) => compareDates(a.date, b.date) || b.value - a.value)
}
