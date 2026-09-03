import type { AssetType } from '../domain/constants.js'

/**
 * Rótulo em português de cada tipo de ativo — para badge, filtro, `<select>` e legenda.
 *
 * O código (`TESOURO_DIRETO`, `RENDA_FIXA`) é chave de banco e de cor, não texto de tela;
 * ele vazava para a interface porque nunca houve um mapa. Este é o par do `labelPt` das
 * operações em `transaction-types.ts`. Tipo desconhecido volta como veio: melhor um código
 * cru do que um rótulo inventado para dado que o banco não deveria ter.
 */
const ASSET_TYPE_LABELS: Readonly<Record<AssetType, string>> = {
  STOCK: 'Ação',
  REIT: 'FII',
  ETF: 'ETF',
  BDR: 'BDR',
  TESOURO_DIRETO: 'Tesouro Direto',
  CRYPTO: 'Cripto',
  INTERNATIONAL: 'Internacional',
  RENDA_FIXA: 'Renda Fixa',
  OUTROS: 'Outros',
}

export function assetTypeLabel(type: string | null | undefined): string {
  if (type === null || type === undefined) return '—'
  return (ASSET_TYPE_LABELS as Record<string, string>)[type] ?? type
}
