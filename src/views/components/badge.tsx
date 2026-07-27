import { assetTypeColor, assetTypeTextColor } from '../../shared/asset-colors.js'

/** Porte de src/main/resources/templates/fragments/badge.html. */

const DIVIDEND_BADGE_CLASSES: Record<string, string> = {
  DIVIDENDO: 'bg-success',
  JCP: 'bg-primary',
  RENDIMENTO: 'bg-info',
  BONIFICACAO: 'bg-warning text-dark',
  BTC: 'bg-secondary',
}

/** Mesma cor que o tipo tem nos gráficos do dashboard — ver `shared/asset-colors.ts`. */
export function AssetBadge({ type }: { type: string | null }) {
  if (type === null) return null
  return (
    <span
      class="badge"
      style={`background-color: ${assetTypeColor(type)}; color: ${assetTypeTextColor(type)}`}
    >
      {type}
    </span>
  )
}

export function DividendBadge({ type }: { type: string }) {
  return <span class={`badge ${DIVIDEND_BADGE_CLASSES[type] ?? 'bg-secondary'}`}>{type}</span>
}

export function DelistedBadge({ delisted }: { delisted: boolean }) {
  if (!delisted) return null
  return (
    <span class="badge bg-danger ms-1" title="Ativo deslistado">
      deslistado
    </span>
  )
}
