import { z } from 'zod'
import { TRANSACTION_TYPES } from '../../domain/constants.js'
import type { Transaction } from '../../generated/prisma/client.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { feesSign, transactionTypeMeta } from '../../shared/transaction-types.js'

/** Porte de src/main/kotlin/com/stocks/dto/TransactionDtos.kt. */

const number = z.coerce.number()

export const TransactionForm = z.object({
  ticker: z.string().min(1),
  type: z.string(),
  quantity: number,
  price: number.nullish(),
  total_price: number.nullish(),
  fees: number.default(0),
  date: z.string(),
  currency: z.string().default('BRL'),
  broker: z.string().default(''),
  notes: z.string().default(''),
  returnTo: z.string().optional(),
})

/**
 * Editar é o mesmo formulário de criar, sem o ticker — inclusive o `total_price`, que é o
 * valor **bruto** do negócio.
 *
 * Antes o bruto ficava de fora e o preço era obrigatório, então corrigir uma linha pelo
 * valor da nota só dava certo na tela de transações. As duas telas passam pelo mesmo
 * `resolvePrice()`, que é quem exige preço ou bruto.
 */
export const TransactionEditForm = TransactionForm.omit({ ticker: true })

export const TransactionApiRequest = z.object({
  assetId: z.string().min(1),
  type: z.enum(TRANSACTION_TYPES),
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  fees: z.number().default(0),
  date: z.string(),
  broker: z.string().nullish(),
  notes: z.string().nullish(),
})

/** Linha da tabela de histórico — o TransactionTemplateData do controller Kotlin. */
export type TransactionView = {
  id: number
  assetTicker: string
  type: string
  quantity: number
  price: number
  fees: number
  date: IsoDate
  broker: string | null
  notes: string | null
  /** Quando presente, a linha ganha o link para a nota de negociação de origem. */
  brokerNoteId: number | null
  /** Valor **líquido**: o que saiu ou entrou na conta, já com as taxas. */
  netTotal: number
  currency: string
  priceBrl: number
  feesBrl: number
  netTotalBrl: number
}

/**
 * O total da linha é o valor **líquido** — o que de fato saiu ou entrou na conta, com as
 * taxas somadas na compra e descontadas na venda, pelo `feesSign`.
 *
 * O nome é `netTotal`, e não `total`, de propósito: o formulário tem um campo `total_price`
 * que é o **bruto** (quantidade × preço, sem taxas). Os dois são números diferentes e
 * legítimos, e cada tela rotula o seu — foi chamar os dois de "total" que fez a linha de
 * uma venda voltar 2 × taxas menor do que o digitado.
 */
export function toTransactionView(tx: Transaction): TransactionView {
  const absQuantity = Math.abs(tx.quantity)
  const sign = feesSign(transactionTypeMeta(tx.type))
  return {
    id: tx.id,
    assetTicker: tx.assetId,
    type: tx.type,
    quantity: absQuantity,
    price: tx.price,
    fees: tx.fees,
    date: tx.date as IsoDate,
    broker: tx.broker,
    notes: tx.notes,
    brokerNoteId: tx.brokerNoteId,
    netTotal: absQuantity * tx.price + sign * tx.fees,
    currency: tx.currency,
    priceBrl: tx.priceBrl,
    feesBrl: tx.feesBrl,
    netTotalBrl: absQuantity * tx.priceBrl + sign * tx.feesBrl,
  }
}

/** Resposta da API JSON. A quantidade sai sempre positiva; o tipo diz o sentido. */
export function toTransactionResponse(tx: Transaction) {
  return {
    id: tx.id,
    assetId: tx.assetId,
    type: tx.type,
    quantity: Math.abs(tx.quantity),
    price: tx.price,
    fees: tx.fees,
    date: tx.date,
    broker: tx.broker,
    notes: tx.notes,
    createdAt: tx.createdAt,
  }
}
