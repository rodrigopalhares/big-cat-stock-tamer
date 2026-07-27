import { TRANSACTION_TYPES, type TransactionType } from '../domain/constants.js'

/**
 * O que cada tipo de transação faz — fonte única para o cálculo, para as views e para o
 * TypeScript de navegador.
 *
 * Antes o comportamento estava espalhado: o sinal da quantidade era decidido em dois
 * ternários no service e num terceiro no schema, a cor e o rótulo do badge eram um
 * `type === 'BUY' ? ... : ...` duplicado em duas páginas, e o `calculatePosition` nem
 * olhava o tipo — deduzia compra ou venda pelo sinal. Com seis tipos isso não fecha:
 * agrupamento também reduz a quantidade e não pode realizar resultado. Um mapa só resolve,
 * na mesma linha do que `shared/asset-colors.ts` fez com a paleta.
 */

/**
 * Como o evento mexe no custo acumulado:
 * - `MARKET`: dinheiro trocou de mãos ao preço negociado (compra e venda).
 * - `FIXED_PRICE`: entra ao custo unitário atribuído pela empresa (bonificação).
 * - `NONE`: o custo total não muda — só a quantidade (desdobramento e agrupamento).
 * - `RETURN_OF_CAPITAL`: a empresa devolve capital — o custo cai e a quantidade fica
 *   igual (redução de capital). É devolução, não renda: por isso abate custo em vez de
 *   virar provento.
 */
export type CostEffect = 'MARKET' | 'FIXED_PRICE' | 'NONE' | 'RETURN_OF_CAPITAL'

export type TransactionTypeMeta = {
  readonly type: TransactionType
  /**
   * Sinal com que a quantidade é gravada — a digitada é sempre positiva.
   * Não confundir com efeito na posição: `RETURN_OF_CAPITAL` grava positivo e mesmo
   * assim não movimenta a quantidade.
   */
  readonly sign: 1 | -1
  readonly costEffect: CostEffect
  /** Entra no fluxo de caixa da TIR/XIRR. Evento societário não desembolsa nada. */
  readonly cashFlow: boolean
  readonly labelPt: string
  readonly badgeClass: string
  readonly icon: string
  /** Rótulo do campo de preço; `null` esconde preço, total e taxas no formulário. */
  readonly priceFieldLabel: string | null
}

const TRANSACTION_TYPE_META: Readonly<Record<TransactionType, TransactionTypeMeta>> = {
  BUY: {
    type: 'BUY',
    sign: 1,
    costEffect: 'MARKET',
    cashFlow: true,
    labelPt: 'Compra',
    badgeClass: 'bg-success',
    icon: 'bi-arrow-down-circle',
    priceFieldLabel: 'Preço Unit.',
  },
  SELL: {
    type: 'SELL',
    sign: -1,
    costEffect: 'MARKET',
    cashFlow: true,
    labelPt: 'Venda',
    badgeClass: 'bg-danger',
    icon: 'bi-arrow-up-circle',
    priceFieldLabel: 'Preço Unit.',
  },
  BONIFICACAO: {
    type: 'BONIFICACAO',
    sign: 1,
    costEffect: 'FIXED_PRICE',
    cashFlow: false,
    labelPt: 'Bonificação',
    badgeClass: 'bg-warning text-dark',
    icon: 'bi-gift',
    priceFieldLabel: 'Custo Unit. Atribuído',
  },
  DESDOBRAMENTO: {
    type: 'DESDOBRAMENTO',
    sign: 1,
    costEffect: 'NONE',
    cashFlow: false,
    labelPt: 'Desdobramento',
    badgeClass: 'bg-primary',
    icon: 'bi-arrows-angle-expand',
    priceFieldLabel: null,
  },
  // Cinza, não vermelho: agrupamento reduz a quantidade mas não é venda e não realiza nada.
  AGRUPAMENTO: {
    type: 'AGRUPAMENTO',
    sign: -1,
    costEffect: 'NONE',
    cashFlow: false,
    labelPt: 'Agrupamento',
    badgeClass: 'bg-secondary',
    icon: 'bi-arrows-angle-contract',
    priceFieldLabel: null,
  },
  REDUCAO_CAPITAL: {
    type: 'REDUCAO_CAPITAL',
    sign: 1,
    costEffect: 'RETURN_OF_CAPITAL',
    cashFlow: true,
    labelPt: 'Redução de Capital',
    badgeClass: 'bg-info text-dark',
    icon: 'bi-cash-stack',
    priceFieldLabel: 'Valor por Ação',
  },
}

/** Na ordem de `TRANSACTION_TYPES` — é o que os `<select>` percorrem. */
export const TRANSACTION_TYPE_LIST: readonly TransactionTypeMeta[] = TRANSACTION_TYPES.map(
  (type) => TRANSACTION_TYPE_META[type],
)

/** Null em tipo desconhecido — para quem renderiza dado de origem duvidosa. */
export function transactionTypeMetaOrNull(type: string): TransactionTypeMeta | null {
  return TRANSACTION_TYPE_META[type as TransactionType] ?? null
}

/**
 * Lança em tipo desconhecido. O `<select>` e o `z.enum` já barram a entrada, então chegar
 * aqui com outra coisa é dado corrompido — e um preço médio errado em silêncio é pior que
 * um 500. Mesma postura de `convertPrices()` com par de moedas não suportado.
 */
export function transactionTypeMeta(type: string): TransactionTypeMeta {
  const meta = transactionTypeMetaOrNull(type)
  if (meta === null) throw new Error(`Tipo de transação desconhecido: ${type}`)
  return meta
}

/**
 * Sinal com que as taxas entram no total exibido.
 *
 * Só na compra o dinheiro sai do bolso e a corretagem soma; na venda e na redução de
 * capital ela é descontada do que se recebe. Nos eventos sem caixa as taxas são zero,
 * então o sinal não muda nada.
 */
export function feesSign(meta: TransactionTypeMeta): 1 | -1 {
  return meta.sign === 1 && meta.costEffect === 'MARKET' ? 1 : -1
}
