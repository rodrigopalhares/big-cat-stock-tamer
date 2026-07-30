import type { AssetType, Currency } from './constants.js'
import { isTesouroTicker } from './tesouro-ticker.js'

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
  if (isTesouroTicker(ticker)) {
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

const REIT_NAME_KEYWORDS = ['fii', 'fundo de investimento imobili', 'fdo inv imob']
const ONLY_LETTERS = /^\p{L}+$/u

/**
 * Distingue FII de ação quando o Yahoo classifica os dois como EQUITY.
 * Porte de `isBrazilianReit` em QuoteService.kt.
 *
 * Dois sinais: o código termina em 11 com prefixo só de letras, ou o nome traz
 * uma das expressões que as gestoras usam.
 */
export function isBrazilianReit(symbol: string, name: string): boolean {
  const baseTicker = symbol.endsWith('.SA') ? symbol.slice(0, -3) : symbol
  if (
    baseTicker.length >= 5 &&
    baseTicker.endsWith('11') &&
    ONLY_LETTERS.test(baseTicker.slice(0, -2))
  ) {
    return true
  }
  const lowerName = name.toLowerCase()
  return REIT_NAME_KEYWORDS.some((keyword) => lowerName.includes(keyword))
}
