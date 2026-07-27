import { describe, expect, it } from 'vitest'
import { TRANSACTION_TYPES } from '../domain/constants.js'
import {
  feesSign,
  TRANSACTION_TYPE_LIST,
  transactionTypeMeta,
  transactionTypeMetaOrNull,
} from './transaction-types.js'

describe('transactionTypeMeta', () => {
  it('compra, venda e redução de capital movimentam dinheiro', () => {
    const comCaixa = TRANSACTION_TYPES.filter((t) => transactionTypeMeta(t).cashFlow)
    expect(comCaixa).toEqual(['BUY', 'SELL', 'REDUCAO_CAPITAL'])
  })

  it('redução de capital devolve capital em vez de mexer na quantidade', () => {
    expect(transactionTypeMeta('REDUCAO_CAPITAL').costEffect).toBe('RETURN_OF_CAPITAL')
  })

  it('só venda e agrupamento reduzem a posição', () => {
    const reduzem = TRANSACTION_TYPES.filter((t) => transactionTypeMeta(t).sign === -1)
    expect(reduzem).toEqual(['SELL', 'AGRUPAMENTO'])
  })

  it('desdobramento e agrupamento não mexem no custo', () => {
    expect(transactionTypeMeta('DESDOBRAMENTO').costEffect).toBe('NONE')
    expect(transactionTypeMeta('AGRUPAMENTO').costEffect).toBe('NONE')
  })

  it('bonificação entra pelo custo atribuído', () => {
    expect(transactionTypeMeta('BONIFICACAO').costEffect).toBe('FIXED_PRICE')
  })

  it('quem não tem preço não mostra o campo', () => {
    expect(transactionTypeMeta('DESDOBRAMENTO').priceFieldLabel).toBeNull()
    expect(transactionTypeMeta('AGRUPAMENTO').priceFieldLabel).toBeNull()
    expect(transactionTypeMeta('BONIFICACAO').priceFieldLabel).not.toBeNull()
  })

  it('todo tipo tem rótulo em português e badge', () => {
    for (const type of TRANSACTION_TYPES) {
      const meta = transactionTypeMeta(type)
      expect(meta.labelPt).not.toBe('')
      expect(meta.badgeClass).not.toBe('')
      expect(meta.icon).not.toBe('')
    }
  })

  it('agrupamento não se parece com venda', () => {
    expect(transactionTypeMeta('AGRUPAMENTO').badgeClass).not.toBe(
      transactionTypeMeta('SELL').badgeClass,
    )
  })

  it('só na compra as taxas somam ao total', () => {
    const somam = TRANSACTION_TYPES.filter((t) => feesSign(transactionTypeMeta(t)) === 1)
    expect(somam).toEqual(['BUY'])
  })

  it('tipo desconhecido lança', () => {
    expect(() => transactionTypeMeta('XPTO')).toThrow(/Tipo de transação desconhecido/)
  })

  it('a variante tolerante devolve null', () => {
    expect(transactionTypeMetaOrNull('XPTO')).toBeNull()
    expect(transactionTypeMetaOrNull('BUY')?.labelPt).toBe('Compra')
  })
})

describe('TRANSACTION_TYPE_LIST', () => {
  it('segue a ordem de TRANSACTION_TYPES', () => {
    expect(TRANSACTION_TYPE_LIST.map((m) => m.type)).toEqual([...TRANSACTION_TYPES])
  })
})
