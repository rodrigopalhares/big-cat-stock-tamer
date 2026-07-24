import { describe, expect, it } from 'vitest'
import { classifyTicker } from './ticker-classification.js'

// Porte de src/test/kotlin/com/stocks/service/TickerPatternTest.kt

describe('Tesouro Direto', () => {
  it('reconhece pelo ponto e vírgula', () => {
    expect(classifyTicker('Tesouro Selic;01/03/2029')).toEqual({
      suggestedType: 'TESOURO_DIRETO',
      yfCandidates: ['Tesouro Selic;01/03/2029'],
      defaultCurrency: 'BRL',
    })
  })

  it('reconhece pelo prefixo TD:', () => {
    expect(classifyTicker('TD:SELIC2029').suggestedType).toBe('TESOURO_DIRETO')
  })
})

describe('internacional com sufixo de bolsa', () => {
  it.each(['SAP.DE', 'VOW3.DE'])('%s é INTERNATIONAL', (ticker) => {
    expect(classifyTicker(ticker)).toEqual({
      suggestedType: 'INTERNATIONAL',
      yfCandidates: [ticker],
      defaultCurrency: 'USD',
    })
  })
})

describe('cripto', () => {
  it.each(['BTC-USD', 'ETH-BRL'])('%s é CRYPTO', (ticker) => {
    expect(classifyTicker(ticker)).toEqual({
      suggestedType: 'CRYPTO',
      yfCandidates: [ticker],
      defaultCurrency: 'USD',
    })
  })

  it('hífen com moeda desconhecida não vira cripto', () => {
    expect(classifyTicker('ABC-XYZ').suggestedType).toBeNull()
  })
})

describe('FII ou ETF brasileiro (termina em 11)', () => {
  it.each(['HGLG11', 'BOVA11', 'KNCRI11'])('%s fica com tipo indefinido', (ticker) => {
    expect(classifyTicker(ticker)).toEqual({
      suggestedType: null,
      yfCandidates: [`${ticker}.SA`],
      defaultCurrency: 'BRL',
    })
  })
})

describe('BDR (4 letras + 34-39)', () => {
  it.each(['AAPL34', 'MSFT34'])('%s é BDR', (ticker) => {
    expect(classifyTicker(ticker)).toEqual({
      suggestedType: 'BDR',
      yfCandidates: [`${ticker}.SA`],
      defaultCurrency: 'BRL',
    })
  })
})

describe('ação brasileira (4 letras + 1-2 dígitos)', () => {
  it.each(['PETR3', 'VALE3', 'ITUB4', 'XYZW99'])('%s é STOCK', (ticker) => {
    expect(classifyTicker(ticker)).toEqual({
      suggestedType: 'STOCK',
      yfCandidates: [`${ticker}.SA`],
      defaultCurrency: 'BRL',
    })
  })
})

describe('internacional (1-5 letras, sem dígito)', () => {
  it.each(['AAPL', 'MSFT', 'GOOGL', 'V'])('%s tenta o símbolo puro antes do .SA', (ticker) => {
    expect(classifyTicker(ticker)).toEqual({
      suggestedType: 'INTERNATIONAL',
      yfCandidates: [ticker, `${ticker}.SA`],
      defaultCurrency: 'USD',
    })
  })
})

describe('fallback', () => {
  it.each(['ABCDEF99', 'abc123'])('%s tenta .SA primeiro, depois o símbolo puro', (ticker) => {
    expect(classifyTicker(ticker)).toEqual({
      suggestedType: null,
      yfCandidates: [`${ticker}.SA`, ticker],
      defaultCurrency: 'BRL',
    })
  })
})
