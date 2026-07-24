import { describe, expect, it } from 'vitest'
import { classifyTicker, isBrazilianReit } from './ticker-classification.js'

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

// Porte de `isBrazilianReit`, privado no QuoteService.kt — o Yahoo devolve EQUITY
// tanto para ação quanto para FII, então o desempate é aqui.
describe('isBrazilianReit', () => {
  it.each([
    ['HGLG11.SA', 'CSHG LOGISTICA'],
    ['KNCRI11.SA', 'KINEA CREDITO'],
    ['MXRF11', 'MAXI RENDA'],
  ])('%s: código de 5+ letras terminando em 11 é FII', (symbol, name) => {
    expect(isBrazilianReit(symbol, name)).toBe(true)
  })

  it.each([
    ['PETR4.SA', 'FII Imobiliario Teste'],
    ['XPTO3.SA', 'Fundo de Investimento Imobiliario XP'],
    ['ABCD3.SA', 'FDO INV IMOB ABC'],
  ])('%s: nome com expressão de FII conta mesmo sem o código 11', (symbol, name) => {
    expect(isBrazilianReit(symbol, name)).toBe(true)
  })

  it.each([
    ['PETR4.SA', 'Petróleo Brasileiro'],
    ['VALE3.SA', 'Vale S.A.'],
    ['AAPL', 'Apple Inc.'],
  ])('%s: ação comum não é FII', (symbol, name) => {
    expect(isBrazilianReit(symbol, name)).toBe(false)
  })

  it('ETF terminado em 11 também casa pelo código — o desempate é a ordem em fetchAssetInfo', () => {
    // BOVA11 é ETF, mas o padrão "letras + 11" não distingue de FII. Quem resolve é
    // fetchAssetInfo, que testa instrumentType === 'ETF' *antes* de chamar esta função.
    // Comportamento idêntico ao do Kotlin; documentado aqui porque não é óbvio.
    expect(isBrazilianReit('BOVA11.SA', 'iShares Ibovespa')).toBe(true)
  })

  it('código com menos de 5 caracteres não casa pelo padrão', () => {
    expect(isBrazilianReit('AB11.SA', 'Qualquer Coisa')).toBe(false)
  })

  it('código com dígito antes do 11 não casa', () => {
    expect(isBrazilianReit('ABC123411.SA', 'Qualquer Coisa')).toBe(false)
  })

  it('a busca no nome ignora maiúsculas', () => {
    expect(isBrazilianReit('XPTO3.SA', 'FUNDO DE INVESTIMENTO IMOBILIÁRIO')).toBe(true)
  })
})
