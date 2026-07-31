import { z } from 'zod'
import type { AssetClass } from '../../generated/prisma/client.js'

/** DTOs da alocação por classe. Os formulários chegam form-urlencoded, tudo string. */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const AssetClassForm = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, 'Informe o nome da classe').max(40)),
  // Meta em ponto percentual (20 = 20%), como está gravado no banco.
  target_percent: z.coerce.number().min(0, 'Meta não pode ser negativa').max(100).default(0),
  color: z.string().regex(HEX_COLOR, 'Cor inválida').default('#6c757d'),
})
export type AssetClassForm = z.output<typeof AssetClassForm>

/** Troca de classe do ativo. String vazia é "sem classe", não erro. */
export const AssignClassForm = z.object({
  class_id: z
    .string()
    .default('')
    .transform((value) => (value.trim() === '' ? null : Number(value)))
    .refine((value) => value === null || Number.isInteger(value), 'Classe inválida'),
})
export type AssignClassForm = z.output<typeof AssignClassForm>

/** Ativo com posição que ficou fora dos percentuais por não ter cotação. */
export type UnpricedAsset = {
  ticker: string
  name: string | null
  type: string
}

export type AssetClassView = {
  id: number
  name: string
  targetPercent: number
  color: string
}

export function toAssetClassView(assetClass: AssetClass): AssetClassView {
  return {
    id: assetClass.id,
    name: assetClass.name,
    targetPercent: assetClass.targetPercent,
    color: assetClass.color,
  }
}
