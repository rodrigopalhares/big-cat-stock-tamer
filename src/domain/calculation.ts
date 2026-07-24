import { compareDates, type IsoDate, today } from '../shared/iso-date.js'
import type { TransactionType } from './constants.js'
import { type CashFlow, computeIrr, xirr } from './xirr.js'

/**
 * Cálculo de posição, preço médio, resultado realizado e fluxo de caixa.
 * Porte de src/main/kotlin/com/stocks/service/CalculationService.kt.
 *
 * Puro e síncrono: sem banco, sem rede, sem relógio (a data "hoje" entra por parâmetro).
 */

export type TransactionData = {
  /** Mantido por fidelidade ao modelo; o que decide compra/venda é o *sinal* de `quantity`. */
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
    const absQty = Math.abs(t.quantity)

    if (t.quantity > 0) {
      // Compra
      const purchaseCost = absQty * t.price + t.fees
      accumulatedCost += purchaseCost
      quantity += absQty
      cashFlows.push({ date: t.date, value: -purchaseCost })

      const purchaseCostBrl = absQty * t.priceBrl + t.feesBrl
      accumulatedCostBrl += purchaseCostBrl
      cashFlowsBrl.push({ date: t.date, value: -purchaseCostBrl })
    } else if (t.quantity < 0 && quantity > 0) {
      // Venda
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

      quantity -= absQty
      cashFlows.push({ date: t.date, value: saleProceeds })
      cashFlowsBrl.push({ date: t.date, value: saleProceedsBrl })
    }
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
