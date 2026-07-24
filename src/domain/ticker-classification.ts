import type { AssetType, Currency } from './constants.js'

/** Porte de src/main/kotlin/com/stocks/service/TickerClassification.kt. */
export type TickerClassification = {
  /** Null quando o padrão não determina o tipo — o Yahoo decide (FII vs ETF). */
  readonly suggestedType: AssetType | null
  /** Símbolos a tentar no Yahoo, em ordem de preferência. */
  readonly yfCandidates: readonly string[]
  readonly defaultCurrency: Currency
}

const FII_OR_ETF = /^[A-Z]{4,6}11$/
const BDR = /^[A-Z]{4}3[4-9]$/
const BR_STOCK = /^[A-Z]{4}\d{1,2}$/
const INTERNATIONAL = /^[A-Z]{1,5}$/

const CRYPTO_QUOTES = new Set(['USD', 'BRL', 'EUR'])

export function classifyTicker(ticker: string): TickerClassification {
  if (ticker.includes(';') || ticker.startsWith('TD:')) {
    return { suggestedType: 'TESOURO_DIRETO', yfCandidates: [ticker], defaultCurrency: 'BRL' }
  }

  if (ticker.includes('.')) {
    return { suggestedType: 'INTERNATIONAL', yfCandidates: [ticker], defaultCurrency: 'USD' }
  }

  if (ticker.includes('-') && CRYPTO_QUOTES.has(ticker.slice(ticker.indexOf('-') + 1))) {
    return { suggestedType: 'CRYPTO', yfCandidates: [ticker], defaultCurrency: 'USD' }
  }

  if (FII_OR_ETF.test(ticker)) {
    return { suggestedType: null, yfCandidates: [`${ticker}.SA`], defaultCurrency: 'BRL' }
  }

  if (BDR.test(ticker)) {
    return { suggestedType: 'BDR', yfCandidates: [`${ticker}.SA`], defaultCurrency: 'BRL' }
  }

  if (BR_STOCK.test(ticker)) {
    return { suggestedType: 'STOCK', yfCandidates: [`${ticker}.SA`], defaultCurrency: 'BRL' }
  }

  if (INTERNATIONAL.test(ticker)) {
    return {
      suggestedType: 'INTERNATIONAL',
      yfCandidates: [ticker, `${ticker}.SA`],
      defaultCurrency: 'USD',
    }
  }

  return { suggestedType: null, yfCandidates: [`${ticker}.SA`, ticker], defaultCurrency: 'BRL' }
}
