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
import type { TransactionType } from './constants.js'
import type { CashFlow } from './xirr.js'

// Porte de src/test/kotlin/com/stocks/service/CalculationServiceTest.kt

function tx(
  type: TransactionType,
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

describe('calculatePosition — eventos societários', () => {
  it('bonificação soma ações e o custo atribuído', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('BONIFICACAO', 10, 5, 0, '2024-02-01'),
    ])
    expect(result.quantity).toBeCloseTo(110, 3)
    expect(result.totalCost).toBeCloseTo(2050, 3) // 2000 + 10 × 5
    expect(result.avgPrice).toBeCloseTo(18.6364, 3)
    expect(result.realizedPnl).toBeCloseTo(0, 3)
  })

  it('bonificação sem custo atribuído só dilui o preço médio', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('BONIFICACAO', 10, 0, 0, '2024-02-01'),
    ])
    expect(result.quantity).toBeCloseTo(110, 3)
    expect(result.totalCost).toBeCloseTo(2000, 3)
    expect(result.avgPrice).toBeCloseTo(18.1818, 3)
  })

  it('bonificação também entra no custo em reais', () => {
    const result = calculatePosition([
      tx('BUY', 10, 10, 0, '2024-01-01', { priceBrl: 50 }),
      tx('BONIFICACAO', 2, 1, 0, '2024-02-01', { priceBrl: 5 }),
    ])
    expect(result.totalCost).toBeCloseTo(102, 3)
    expect(result.totalCostBrl).toBeCloseTo(510, 3)
    expect(result.avgPrice).toBeCloseTo(8.5, 3)
    expect(result.avgPriceBrl).toBeCloseTo(42.5, 3)
  })

  it('desdobramento mantém o custo e divide o preço médio', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('DESDOBRAMENTO', 100, 0, 0, '2024-02-01'),
    ])
    expect(result.quantity).toBeCloseTo(200, 3)
    expect(result.totalCost).toBeCloseTo(2000, 3)
    expect(result.avgPrice).toBeCloseTo(10, 3)
    expect(result.realizedPnl).toBeCloseTo(0, 3)
  })

  it('agrupamento mantém o custo, concentra o preço médio e não realiza nada', () => {
    const result = calculatePosition([
      tx('BUY', 1000, 1, 0, '2024-01-01'),
      tx('AGRUPAMENTO', -900, 0, 0, '2024-02-01'),
    ])
    expect(result.quantity).toBeCloseTo(100, 3)
    expect(result.totalCost).toBeCloseTo(1000, 3)
    expect(result.avgPrice).toBeCloseTo(10, 3)
    expect(result.realizedPnl).toBe(0)
  })

  it('agrupamento sem posição é ignorado', () => {
    const result = calculatePosition([tx('AGRUPAMENTO', -900, 0, 0, '2024-01-01')])
    expect(result.quantity).toBeCloseTo(0, 3)
    expect(result.realizedPnl).toBe(0)
  })

  it('venda depois do desdobramento usa o preço médio diluído', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('DESDOBRAMENTO', 100, 0, 0, '2024-02-01'),
      tx('SELL', -200, 12, 0, '2024-03-01'),
    ])
    // 200 × 12 = 2400 de venda contra 2000 de custo.
    expect(result.realizedPnl).toBeCloseTo(400, 3)
    expect(result.quantity).toBe(0)
  })

  it('venda depois do agrupamento usa o preço médio concentrado', () => {
    const result = calculatePosition([
      tx('BUY', 1000, 1, 0, '2024-01-01'),
      tx('AGRUPAMENTO', -900, 0, 0, '2024-02-01'),
      tx('SELL', -100, 12, 0, '2024-03-01'),
    ])
    // 100 × 12 = 1200 de venda contra 1000 de custo.
    expect(result.realizedPnl).toBeCloseTo(200, 3)
    expect(result.quantity).toBe(0)
  })

  it('evento societário não gera fluxo de caixa', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('BONIFICACAO', 10, 5, 0, '2024-02-01'),
      tx('DESDOBRAMENTO', 110, 0, 0, '2024-03-01'),
      tx('AGRUPAMENTO', -110, 0, 0, '2024-04-01'),
      tx('SELL', -110, 30, 0, '2024-05-01'),
    ])
    // Só a compra e a venda movimentaram dinheiro.
    expect(result.cashFlows).toHaveLength(2)
    expect(result.cashFlowsBrl).toHaveLength(2)
    expect(result.cashFlows[0]?.value).toBeLessThan(0)
    expect(result.cashFlows[1]?.value).toBeGreaterThan(0)
  })

  it('o desdobramento vale na data dele, não na ordem de entrada', () => {
    const result = calculatePosition([
      tx('DESDOBRAMENTO', 100, 0, 0, '2024-02-01'),
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('BUY', 100, 10, 0, '2024-03-01'),
    ])
    // 100 a 20 viram 200 a 10; mais 100 a 10 ⇒ 300 ações a 10.
    expect(result.quantity).toBeCloseTo(300, 3)
    expect(result.totalCost).toBeCloseTo(3000, 3)
    expect(result.avgPrice).toBeCloseTo(10, 3)
  })

  it('redução de capital abate o custo sem mexer na quantidade', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('REDUCAO_CAPITAL', 100, 2, 0, '2024-02-01'),
    ])
    expect(result.quantity).toBeCloseTo(100, 3)
    expect(result.totalCost).toBeCloseTo(1800, 3) // 2000 − 100 × 2
    expect(result.avgPrice).toBeCloseTo(18, 3)
    expect(result.realizedPnl).toBe(0)
  })

  it('redução de capital entra como dinheiro recebido no fluxo de caixa', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('REDUCAO_CAPITAL', 100, 2, 0, '2024-02-01'),
    ])
    expect(result.cashFlows).toHaveLength(2)
    expect(result.cashFlows[1]?.value).toBeCloseTo(200, 3)
  })

  it('as taxas saem do valor devolvido', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('REDUCAO_CAPITAL', 100, 2, 10, '2024-02-01'),
    ])
    // 200 recebidos menos 10 de taxa.
    expect(result.totalCost).toBeCloseTo(1810, 3)
    expect(result.cashFlows[1]?.value).toBeCloseTo(190, 3)
  })

  it('devolver mais que o custo para em zero e o excedente vira ganho', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('REDUCAO_CAPITAL', 100, 25, 0, '2024-02-01'),
    ])
    // 2500 devolvidos sobre 2000 de custo: custo zera, 500 viram resultado.
    expect(result.totalCost).toBe(0)
    expect(result.avgPrice).toBe(0)
    expect(result.realizedPnl).toBeCloseTo(500, 3)
    expect(result.quantity).toBeCloseTo(100, 3)
  })

  it('redução de capital sem posição é ignorada', () => {
    const result = calculatePosition([tx('REDUCAO_CAPITAL', 100, 2, 0, '2024-01-01')])
    expect(result.quantity).toBe(0)
    expect(result.totalCost).toBeCloseTo(0, 3)
    expect(result.cashFlows).toHaveLength(0)
  })

  it('venda depois da redução de capital usa o preço médio já abatido', () => {
    const result = calculatePosition([
      tx('BUY', 100, 20, 0, '2024-01-01'),
      tx('REDUCAO_CAPITAL', 100, 2, 0, '2024-02-01'),
      tx('SELL', -100, 19, 0, '2024-03-01'),
    ])
    // Custo médio de 18 depois da devolução; venda a 19 ⇒ 100 de lucro.
    expect(result.realizedPnl).toBeCloseTo(100, 3)
    expect(result.quantity).toBe(0)
  })

  it('redução de capital também abate o custo em reais', () => {
    const result = calculatePosition([
      tx('BUY', 10, 10, 0, '2024-01-01', { priceBrl: 50 }),
      tx('REDUCAO_CAPITAL', 10, 2, 0, '2024-02-01', { priceBrl: 10 }),
    ])
    expect(result.totalCost).toBeCloseTo(80, 3) // 100 − 20
    expect(result.totalCostBrl).toBeCloseTo(400, 3) // 500 − 100
  })

  it('tipo desconhecido não passa em silêncio', () => {
    expect(() =>
      calculatePosition([tx('XPTO' as TransactionType, 10, 1, 0, '2024-01-01')]),
    ).toThrow(/Tipo de transação desconhecido/)
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
