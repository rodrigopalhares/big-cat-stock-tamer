/** Porte de src/main/resources/templates/fragments/badge.html. */

const ASSET_BADGE_CLASSES: Record<string, string> = {
  STOCK: 'bg-primary',
  REIT: 'bg-success',
  ETF: 'bg-info',
  TESOURO_DIRETO: 'bg-warning text-dark',
  CRYPTO: 'bg-dark',
  RENDA_FIXA: 'text-bg-info',
  OUTROS: 'bg-secondary',
}

const DIVIDEND_BADGE_CLASSES: Record<string, string> = {
  DIVIDENDO: 'bg-success',
  JCP: 'bg-primary',
  RENDIMENTO: 'bg-info',
  BONIFICACAO: 'bg-warning text-dark',
  BTC: 'bg-secondary',
}

export function AssetBadge({ type }: { type: string | null }) {
  if (type === null) return null
  return <span class={`badge ${ASSET_BADGE_CLASSES[type] ?? 'bg-secondary'}`}>{type}</span>
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
