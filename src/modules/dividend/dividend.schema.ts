import { z } from 'zod'
import { DIVIDEND_TYPES, VALID_CURRENCIES } from '../../domain/constants.js'
import type { Dividend } from '../../generated/prisma/client.js'
import type { IsoDate } from '../../shared/iso-date.js'

/** Porte de src/main/kotlin/com/stocks/dto/DividendDtos.kt. */

const number = z.coerce.number()

export const DividendForm = z.object({
  ticker: z.string().min(1),
  type: z.string(),
  total_amount: number,
  tax_withheld: number.default(0),
  date: z.string(),
  currency: z.string().default('BRL'),
  broker: z.string().default(''),
  notes: z.string().default(''),
  returnTo: z.string().optional(),
})

export const DividendEditForm = DividendForm.omit({ ticker: true })

export const DividendApiRequest = z.object({
  ticker: z.string().min(1),
  type: z.enum(DIVIDEND_TYPES),
  date: z.string(),
  totalAmount: z.number().positive(),
  taxWithheld: z.number().nonnegative().default(0),
  currency: z.enum(VALID_CURRENCIES).default('BRL'),
  broker: z.string().nullish(),
  notes: z.string().nullish(),
})

/** Linha da tabela — o DividendTemplateData do controller Kotlin. */
export type DividendView = {
  id: number
  assetTicker: string
  type: string
  date: IsoDate
  totalAmount: number
  taxWithheld: number
  netAmount: number
  totalAmountBrl: number
  taxWithheldBrl: number
  netAmountBrl: number
  broker: string | null
  currency: string
  notes: string | null
}

export function toDividendView(d: Dividend): DividendView {
  return {
    id: d.id,
    assetTicker: d.assetId,
    type: d.type,
    date: d.date as IsoDate,
    totalAmount: d.totalAmount,
    taxWithheld: d.taxWithheld,
    netAmount: d.totalAmount - d.taxWithheld,
    totalAmountBrl: d.totalAmountBrl,
    taxWithheldBrl: d.taxWithheldBrl,
    netAmountBrl: d.totalAmountBrl - d.taxWithheldBrl,
    broker: d.broker,
    currency: d.currency,
    notes: d.notes,
  }
}

export function toDividendResponse(d: Dividend) {
  return {
    id: d.id,
    assetId: d.assetId,
    type: d.type,
    date: d.date,
    totalAmount: d.totalAmount,
    taxWithheld: d.taxWithheld,
    netAmount: d.totalAmount - d.taxWithheld,
    broker: d.broker,
    currency: d.currency,
    notes: d.notes,
    createdAt: d.createdAt,
  }
}
