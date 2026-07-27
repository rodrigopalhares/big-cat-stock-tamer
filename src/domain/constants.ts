/** Porte de src/main/kotlin/com/stocks/dto/Constants.kt. */

export const ASSET_TYPES = [
  'STOCK',
  'REIT',
  'ETF',
  'BDR',
  'TESOURO_DIRETO',
  'CRYPTO',
  'INTERNATIONAL',
  'RENDA_FIXA',
  'OUTROS',
] as const
export type AssetType = (typeof ASSET_TYPES)[number]

/** Tipos sem cotação em bolsa — o preço vem do próprio custo. */
export const NO_QUOTE_TYPES = new Set<AssetType>(['RENDA_FIXA', 'OUTROS'])

export const DIVIDEND_TYPES = ['DIVIDENDO', 'JCP', 'RENDIMENTO', 'BONIFICACAO', 'BTC'] as const
export type DividendType = (typeof DIVIDEND_TYPES)[number]

export const VALID_CURRENCIES = ['BRL', 'USD'] as const
export type Currency = (typeof VALID_CURRENCIES)[number]

/**
 * Compra e venda movimentam dinheiro; os três eventos societários só ajustam a posição.
 * O que cada tipo faz com quantidade, custo e fluxo de caixa está em
 * `src/shared/transaction-types.ts` — aqui fica só a lista.
 */
export const TRANSACTION_TYPES = [
  'BUY',
  'SELL',
  'BONIFICACAO',
  'DESDOBRAMENTO',
  'AGRUPAMENTO',
  'REDUCAO_CAPITAL',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/** Variações que as corretoras usam para o mesmo tipo de provento. */
export const DIVIDEND_TYPE_ALIASES: Readonly<Record<string, DividendType>> = {
  DIVIDENDO: 'DIVIDENDO',
  DIVIDENDOS: 'DIVIDENDO',
  DIV: 'DIVIDENDO',
  'REEMBOLSO(DIV)': 'DIVIDENDO',
  JCP: 'JCP',
  JSCP: 'JCP',
  'JUROS SOBRE CAPITAL PROPRIO': 'JCP',
  'JUROS SOBRE CAPITAL': 'JCP',
  'JUROS S/ CAPITAL': 'JCP',
  RENDIMENTO: 'RENDIMENTO',
  RENDIMENTOS: 'RENDIMENTO',
  REND: 'RENDIMENTO',
  BONIFICACAO: 'BONIFICACAO',
  BONIFICAÇÃO: 'BONIFICACAO',
  BTC: 'BTC',
}

/** Variações que as corretoras e o CSV usam para o mesmo tipo de transação. */
export const TRANSACTION_TYPE_ALIASES: Readonly<Record<string, TransactionType>> = {
  C: 'BUY',
  COMPRA: 'BUY',
  BUY: 'BUY',
  V: 'SELL',
  VENDA: 'SELL',
  SELL: 'SELL',
  B: 'BONIFICACAO',
  BN: 'BONIFICACAO',
  BONIFICACAO: 'BONIFICACAO',
  BONIFICAÇÃO: 'BONIFICACAO',
  D: 'DESDOBRAMENTO',
  DESDOBRAMENTO: 'DESDOBRAMENTO',
  SPLIT: 'DESDOBRAMENTO',
  A: 'AGRUPAMENTO',
  AGRUPAMENTO: 'AGRUPAMENTO',
  GRUPAMENTO: 'AGRUPAMENTO',
  INPLIT: 'AGRUPAMENTO',
  'R.CAP': 'REDUCAO_CAPITAL',
  RCAP: 'REDUCAO_CAPITAL',
  REDUCAO_CAPITAL: 'REDUCAO_CAPITAL',
  'REDUCAO DE CAPITAL': 'REDUCAO_CAPITAL',
  'REDUÇÃO DE CAPITAL': 'REDUCAO_CAPITAL',
}

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value)
}

export function isDividendType(value: string): value is DividendType {
  return (DIVIDEND_TYPES as readonly string[]).includes(value)
}

export function isCurrency(value: string): value is Currency {
  return (VALID_CURRENCIES as readonly string[]).includes(value)
}
