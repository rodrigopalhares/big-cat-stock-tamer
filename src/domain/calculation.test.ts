import { describe, expect, it } from 'vitest'
import { isoDate } from '../shared/iso-date.js'
import {
  buildCashFlows,
  calculateIrr,
  calculatePosition,
  calculateUnrealizedPnl,
  calculateXirr,
  type TransactionData,
} from './calculation.js'
import type { CashFlow } from './xirr.js'

// Porte de src/test/kotlin/com/stocks/service/CalculationServiceTest.kt

function tx(
  type: 'BUY' | 'SELL',
  quantity: number,
  price: number,
  fees: number,
  date: string,
  overrides: Partial<TransactionData> = {},
): TransactionData {
  return {
    type,
    quantity,
    price,
    fees,
    date: isoDate(date),
    priceBrl: price,
    feesBrl: fees,
    ...overrides,
  }
}

const flow = (date: string, value: number): CashFlow => ({ date: isoDate(date), value })

describe('calculatePosition', () => {
  it('compra única', () => {
    const result = calculatePosition([tx('BUY', 10, 10, 0, '2024-01-01')])
    expect(result.quantity).toBeCloseTo(10, 3)
    expect(result.avgPrice).toBeCloseTo(10, 3)
    expect(result.totalCost).toBeCloseTo(100, 3)
    expect(result.realizedPnl).toBeCloseTo(0, 3)
  })

  it('compra com corretagem entra no preço médio', () => {
    const result = calculatePosition([tx('BUY', 10, 10, 5, '2024-01-01')])
    expect(result.avgPrice).toBeCloseTo(10.5, 3)
    expect(result.totalCost).toBeCloseTo(105, 3)
  })

  it('duas compras dão média ponderada', () => {
    const result = calculatePosition([
      tx('BUY', 10, 10, 0, '2024-01-01'),
      tx('BUY', 10, 20, 0, '2024-01-02'),
    ])
    expect(result.avgPrice).toBeCloseTo(15, 3)
    expect(result.quantity).toBeCloseTo(20, 3)
  })

  it('compra e venda com lucro', () => {
    const result = calculatePosition([
      tx('BUY', 10, 10, 0, '2024-01-01'),
      tx('SELL', -10, 15, 0, '2024-01-02'),
    ])
    expect(result.realizedPnl).toBeCloseTo(50, 3)
    expect(result.quantity).toBeCloseTo(0, 3)
  })

  it('compra e venda com prejuízo', () => {
    const result = calculatePosition([
      tx('BUY', 10, 10, 0, '2024-01-01'),
      tx('SELL', -10, 8, 0, '2024-01-02'),
    ])
    expect(result.realizedPnl).toBeCloseTo(-20, 3)
  })

  it('venda total zera a quantidade apesar do ponto flutuante', () => {
    const result = calculatePosition([
      tx('BUY', 0.1298, 100, 0, '2024-01-01'),
      tx('BUY', 0.1014, 100, 0, '2024-01-02'),
      tx('SELL', -0.2312, 120, 0, '2024-01-03'),
    ])
    expect(result.quantity).toBe(0)
  })

  it('venda sem compra é ignorada', () => {
    const result = calculatePosition([tx('SELL', -10, 15, 0, '2024-01-01')])
    expect(result.quantity).toBeCloseTo(0, 3)
    expect(result.realizedPnl).toBeCloseTo(0, 3)
  })

  it('lista vazia', () => {
    const result = calculatePosition([])
    expect(result.quantity).toBe(0)
    expect(result.avgPrice).toBe(0)
    expect(result.totalCost).toBe(0)
    expect(result.realizedPnl).toBe(0)
  })

  it('avgPriceBrl usa os valores em reais', () => {
    const result = calculatePosition([
      tx('BUY', 10, 10, 0, '2024-01-01', { priceBrl: 50 }),
      tx('BUY', 10, 20, 0, '2024-01-02', { priceBrl: 110 }),
    ])
    expect(result.avgPrice).toBeCloseTo(15, 3)
    expect(result.avgPriceBrl).toBeCloseTo(80, 3) // (500 + 1100) / 20
    expect(result.totalCostBrl).toBeCloseTo(1600, 3)
  })

  it('sinais do fluxo de caixa: compra negativa, venda positiva', () => {
    const result = calculatePosition([
      tx('BUY', 10, 10, 0, '2024-01-01'),
      tx('SELL', -5, 15, 0, '2024-01-02'),
    ])
    expect(result.cashFlows).toHaveLength(2)
    expect(result.cashFlows[0]?.value).toBeLessThan(0)
    expect(result.cashFlows[1]?.value).toBeGreaterThan(0)
  })

  it('ordena por data antes de calcular, mesmo com entrada fora de ordem', () => {
    const outOfOrder = calculatePosition([
      tx('SELL', -10, 15, 0, '2024-01-02'),
      tx('BUY', 10, 10, 0, '2024-01-01'),
    ])
    expect(outOfOrder.realizedPnl).toBeCloseTo(50, 3)
    expect(outOfOrder.quantity).toBeCloseTo(0, 3)
  })

  it('não altera o array recebido', () => {
    const txs = [tx('SELL', -10, 15, 0, '2024-01-02'), tx('BUY', 10, 10, 0, '2024-01-01')]
    calculatePosition(txs)
    expect(txs[0]?.date).toBe('2024-01-02')
  })
})

describe('buildCashFlows', () => {
  it('devolve os mesmos fluxos que calculatePosition', () => {
    const txs = [
      tx('BUY', 10, 10, 0, '2024-01-01', { priceBrl: 50 }),
      tx('SELL', -5, 15, 0, '2024-01-02', { priceBrl: 75 }),
    ]
    const position = calculatePosition(txs)
    const flows = buildCashFlows(txs)
    expect(flows.cashFlows).toEqual(position.cashFlows)
    expect(flows.cashFlowsBrl).toEqual(position.cashFlowsBrl)
  })
})

describe('calculateUnrealizedPnl', () => {
  it('lucro', () => {
    expect(calculateUnrealizedPnl(10, 10, 15)).toBeCloseTo(50, 3)
  })

  it('prejuízo', () => {
    expect(calculateUnrealizedPnl(10, 10, 8)).toBeCloseTo(-20, 3)
  })

  it('empate', () => {
    expect(calculateUnrealizedPnl(10, 10, 10)).toBeCloseTo(0, 3)
  })
})

describe('calculateIrr', () => {
  it('fluxos vazios', () => {
    expect(calculateIrr([])).toBeNull()
  })

  it('fluxo único', () => {
    expect(calculateIrr([flow('2024-01-01', -100)])).toBeNull()
  })

  it('fluxos válidos devolvem número', () => {
    const result = calculateIrr([flow('2024-01-01', -100), flow('2024-06-01', 120)])
    expect(result).not.toBeNull()
    expect(Number.isFinite(result as number)).toBe(true)
  })

  it('valor atual completa o fluxo único', () => {
    const flows = [flow('2024-01-01', -100)]
    expect(calculateIrr(flows)).toBeNull()
    expect(calculateIrr(flows, 120)).not.toBeNull()
  })

  it('valor atual não positivo é ignorado', () => {
    expect(calculateIrr([flow('2024-01-01', -100)], 0)).toBeNull()
  })
})

describe('calculateXirr', () => {
  const asOf = isoDate('2025-06-01')

  it('fluxos vazios', () => {
    expect(calculateXirr([], null, asOf)).toBeNull()
  })

  it('fluxo único', () => {
    expect(calculateXirr([flow('2024-01-01', -100)], null, asOf)).toBeNull()
  })

  it('todos negativos', () => {
    const flows = [flow('2024-01-01', -100), flow('2024-02-01', -50)]
    expect(calculateXirr(flows, null, asOf)).toBeNull()
  })

  it('todos positivos', () => {
    const flows = [flow('2024-01-01', 100), flow('2024-02-01', 50)]
    expect(calculateXirr(flows, null, asOf)).toBeNull()
  })

  it('compra e venda válidas dão retorno positivo', () => {
    const flows = [flow('2024-01-01', -1000), flow('2025-01-01', 1200)]
    const result = calculateXirr(flows, null, asOf)
    expect(result).not.toBeNull()
    expect(result as number).toBeGreaterThan(0)
  })

  it('20% em um ano exato dá aproximadamente 20%', () => {
    // 366 dias (2024 é bissexto) sobre base de 365 — daí a folga na tolerância.
    const flows = [flow('2024-01-01', -1000), flow('2025-01-01', 1200)]
    expect(calculateXirr(flows, null, asOf) as number).toBeCloseTo(0.2, 2)
  })

  it('prejuízo dá retorno negativo', () => {
    const flows = [flow('2024-01-01', -1000), flow('2025-01-01', 800)]
    expect(calculateXirr(flows, null, asOf) as number).toBeLessThan(0)
  })

  it('valor atual entra na data informada', () => {
    const flows = [flow('2024-01-01', -1000)]
    expect(calculateXirr(flows, 1200, isoDate('2025-01-01')) as number).toBeCloseTo(0.2, 2)
  })
})
