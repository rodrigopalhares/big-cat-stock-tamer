import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../generated/prisma/client.js'
import { toTransactionView } from './transaction.schema.js'

/**
 * O total da linha é o bruto: quantidade × preço, sem taxas, para todo tipo.
 *
 * O caso que motivou a regra foi uma venda de TD:IPCA2026 — 29,45 × 4.453,821 com 7.987,98
 * de taxas. O formulário somava as taxas ao total e a tabela as descontava, então o bruto
 * digitado voltava 2 × taxas menor. Os dois lados agora dizem o mesmo número.
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
  it('compra: total é o bruto, sem somar as taxas', () => {
    expect(toTransactionView(tx({}))).toMatchObject({ total: 2500, fees: 10 })
  })

  it('venda: total é o bruto, sem descontar as taxas', () => {
    const view = toTransactionView(
      tx({ type: 'SELL', quantity: -29.45, price: 4453.821, fees: 7987.98 }),
    )

    expect(view.quantity).toBe(29.45)
    expect(view.total).toBeCloseTo(131165.03, 2)
    expect(view.fees).toBeCloseTo(7987.98, 2)
  })

  it('redução de capital: total é o bruto recebido', () => {
    const view = toTransactionView(
      tx({ type: 'REDUCAO_CAPITAL', quantity: 100, price: 2, fees: 5 }),
    )

    expect(view.total).toBe(200)
  })

  it('a coluna em reais segue a mesma regra', () => {
    const view = toTransactionView(
      tx({ type: 'SELL', quantity: -10, price: 8, fees: 1, priceBrl: 40, feesBrl: 5 }),
    )

    expect(view.total).toBe(80)
    expect(view.totalBrl).toBe(400)
  })
})
