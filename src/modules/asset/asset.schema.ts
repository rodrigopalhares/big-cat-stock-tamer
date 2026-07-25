import { z } from 'zod'
import { ASSET_TYPES, VALID_CURRENCIES } from '../../domain/constants.js'
import type { Asset } from '../../generated/prisma/client.js'

/**
 * DTOs de ativo — substitui src/main/kotlin/com/stocks/dto/AssetDtos.kt e a validação
 * jakarta. A normalização (uppercase, trim) acontece aqui, na fronteira, em vez de
 * espalhada pelos services como no Kotlin.
 */

export const AssetRequest = z.object({
  ticker: z
    .string()
    .min(1, 'Informe o ticker')
    .transform((value) => value.trim().toUpperCase()),
  yfTicker: z.string().nullish(),
  name: z.string().nullish(),
  type: z.enum(ASSET_TYPES).nullish(),
  currency: z.enum(VALID_CURRENCIES).default('BRL'),
})
export type AssetRequest = z.input<typeof AssetRequest>
export type ParsedAssetRequest = z.output<typeof AssetRequest>

export const AssetFilters = z.object({
  type: z.string().nullish(),
  position: z.string().nullish(),
  delisted: z.string().nullish(),
})
export type AssetFilters = z.infer<typeof AssetFilters>

/** O que sai na API e vai para as views. Espelha o AssetResponse do Kotlin. */
export type AssetView = {
  ticker: string
  yfTicker: string | null
  name: string | null
  type: string
  currency: string
  delisted: boolean
  hasPosition: boolean
  createdAt: Date
}

export function toAssetView(asset: Asset): AssetView {
  return {
    ticker: asset.ticker,
    yfTicker: asset.yfTicker,
    name: asset.name,
    type: asset.type,
    currency: asset.currency,
    delisted: asset.delisted,
    hasPosition: asset.hasPosition,
    createdAt: asset.createdAt,
  }
}
