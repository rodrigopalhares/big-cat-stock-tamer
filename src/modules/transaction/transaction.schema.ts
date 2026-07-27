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

export const TransactionEditForm = TransactionForm.omit({ ticker: true, total_price: true }).extend(
  {
    price: number,
  },
)

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
  total: number
  currency: string
  priceBrl: number
  feesBrl: number
  totalBrl: number
}

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
    total: absQuantity * tx.price + sign * tx.fees,
    currency: tx.currency,
    priceBrl: tx.priceBrl,
    feesBrl: tx.feesBrl,
    totalBrl: absQuantity * tx.priceBrl + sign * tx.feesBrl,
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
