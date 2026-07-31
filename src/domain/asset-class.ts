/**
 * Classe de alocação padrão de cada tipo de ativo.
 *
 * Classe não é tipo: ETF, BDR e ação americana têm tipos diferentes e a mesma classe.
 * Este mapa existe só para o ativo novo já nascer classificado — depois disso quem manda
 * é o que está gravado em `assets.asset_class_id`, que o usuário troca na tela.
 *
 * O mesmo mapa está escrito em SQL na migration `add_asset_classes`, que classificou o
 * que já existia. Mexer aqui sem mexer lá deixa histórico e ativo novo em classes
 * diferentes para o mesmo tipo.
 */

export const DEFAULT_ASSET_CLASSES = [
  { name: 'Ações', targetPercent: 20, color: '#36a2eb' },
  { name: 'Renda Fixa', targetPercent: 20, color: '#795548' },
  { name: 'Internacional', targetPercent: 20, color: '#66bb6a' },
  { name: 'Fii', targetPercent: 20, color: '#9966ff' },
  { name: 'Crypto', targetPercent: 20, color: '#ff6384' },
] as const

const CLASS_BY_TYPE: Readonly<Record<string, string>> = {
  STOCK: 'Ações',
  RENDA_FIXA: 'Renda Fixa',
  TESOURO_DIRETO: 'Renda Fixa',
  ETF: 'Internacional',
  BDR: 'Internacional',
  INTERNATIONAL: 'Internacional',
  CRYPTO: 'Crypto',
  REIT: 'Fii',
}

/**
 * Nome da classe padrão do tipo, ou null quando não há palpite razoável.
 *
 * `OUTROS` cai no null de propósito: é a gaveta de miscelânea, e chutar uma classe para
 * ela esconderia o ativo dentro de um total que não é dele. Sem classe ele aparece no
 * balde "Sem classe" da tela de alocação, que é onde a decisão é tomada.
 */
export function defaultClassNameForType(type: string | null | undefined): string | null {
  if (type === null || type === undefined) return null
  return CLASS_BY_TYPE[type] ?? null
}
