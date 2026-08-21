import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../generated/prisma/client.js'
import { toTransactionView } from './transaction.schema.js'

/**
 * A tabela mostra o líquido: as taxas somam na compra e são descontadas na venda.
 *
 * O que o formulário pede é outra coisa — o bruto, quantidade × preço. Os números da venda
 * de TD:IPCA2026 estão aqui de propósito para deixar a diferença explícita: 29,45 ×
 * 4.453,821 dá R$ 131.165,03 de bruto, e com R$ 7.987,98 de taxas o líquido é R$
 * 123.177,05. Chamar os dois de "total" foi o que fez a linha voltar 2 × taxas menor do que
 * o digitado.
 */
function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1,
    assetId: 'PETR4',
    type: 'BUY',
    quantity: 100,
    price: 25,
    fees: 10,
    priceBrl: 25,
    feesBrl: 10,
    currency: 'BRL',
    date: '2024-01-15',
    broker: null,
    notes: null,
    brokerNoteId: null,
    createdAt: new Date('2024-01-15T00:00:00Z'),
    ...overrides,
  }
}

describe('toTransactionView', () => {
  it('compra: as taxas somam ao que saiu da conta', () => {
    expect(toTransactionView(tx({}))).toMatchObject({ netTotal: 2510, fees: 10 })
  })

  it('venda: as taxas são descontadas do que entrou na conta', () => {
    const view = toTransactionView(
      tx({ type: 'SELL', quantity: -29.45, price: 4453.821, fees: 7987.98 }),
    )

    expect(view.quantity).toBe(29.45)
    expect(view.netTotal).toBeCloseTo(123177.05, 2)
    expect(view.fees).toBeCloseTo(7987.98, 2)
  })

  it('redução de capital: as taxas saem do valor devolvido', () => {
    const view = toTransactionView(
      tx({ type: 'REDUCAO_CAPITAL', quantity: 100, price: 2, fees: 5 }),
    )

    expect(view.netTotal).toBe(195)
  })

  it('a coluna em reais segue a mesma regra', () => {
    const view = toTransactionView(
      tx({ type: 'SELL', quantity: -10, price: 8, fees: 1, priceBrl: 40, feesBrl: 5 }),
    )

    expect(view.netTotal).toBe(79)
    expect(view.netTotalBrl).toBe(395)
  })

  it('evento sem taxas: líquido e bruto coincidem', () => {
    const view = toTransactionView(tx({ type: 'BONIFICACAO', quantity: 50, price: 3, fees: 0 }))

    expect(view.netTotal).toBe(150)
  })
})
