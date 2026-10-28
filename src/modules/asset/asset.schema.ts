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
  // Sem o parâmetro a tela abre só com quem tem posição — é o que se procura quase sempre.
  // "Todos" é `all`; valor desconhecido (inclusive o `position=` de link antigo) cai no padrão.
  position: z.enum(['with', 'without', 'all']).catch('with'),
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
  /** Classe de alocação; null é o balde "Sem classe" de `/allocation/`. */
  assetClassId: number | null
  createdAt: Date
  /** O que a exclusão leva junto — é o número que a confirmação mostra. */
  transactionCount: number
  dividendCount: number
}

/** O `_count` vem do `include` das consultas de listagem; quem não o pede fica com zero. */
export type AssetWithCounts = Asset & {
  _count?: { transactions: number; dividends: number }
}

export function toAssetView(asset: AssetWithCounts): AssetView {
  return {
    ticker: asset.ticker,
    yfTicker: asset.yfTicker,
    name: asset.name,
    type: asset.type,
    currency: asset.currency,
    delisted: asset.delisted,
    hasPosition: asset.hasPosition,
    assetClassId: asset.assetClassId,
    createdAt: asset.createdAt,
    transactionCount: asset._count?.transactions ?? 0,
    dividendCount: asset._count?.dividends ?? 0,
  }
}
