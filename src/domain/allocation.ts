/**
 * Alocação da carteira por classe — percentuais, distância da meta e ordenação.
 *
 * Tudo aqui é aritmética sobre valores já em reais: quem busca cotação e converte moeda é
 * o PortfolioService. Manter a conta separada da busca é o que permite testar "classe 15
 * pontos abaixo da meta" sem banco nem rede.
 *
 * Percentual aqui é **ponto percentual** (20 = 20%), como a meta gravada no banco — não a
 * fração 0.20 que `shared/format.percent` espera. As views formatam com `decimal(x, 2)`.
 */

/** Balde dos ativos sem classe. Id null distingue do id de uma classe de verdade. */
export const UNCLASSIFIED = { id: null, name: 'Sem classe', color: '#6c757d' } as const

export type AllocationAssetInput = {
  ticker: string
  name: string | null
  type: string
  classId: number | null
  /** Valor de mercado em BRL. */
  marketValue: number
}

export type AllocationClassInput = {
  id: number
  name: string
  targetPercent: number
  color: string
}

export type AllocationAsset = {
  ticker: string
  name: string | null
  type: string
  marketValue: number
  /** Peso do ativo dentro da própria classe, em pontos percentuais. */
  percentOfClass: number
  /** Peso do ativo no patrimônio total, em pontos percentuais. */
  percentOfTotal: number
}

export type AllocationClass = {
  /** Null no balde "Sem classe" — ele não existe no banco. */
  id: number | null
  name: string
  color: string
  targetPercent: number
  currentValue: number
  currentPercent: number
  /** Atual − meta, em pontos percentuais. Negativo = abaixo da meta. */
  deviation: number
  /** |deviation| — o quanto está fora do lugar, sem o sinal. */
  distance: number
  /**
   * Reais que faltam para bater a meta (positivo) ou que sobram acima dela (negativo).
   * O excesso não vira venda: a carteira só é rebalanceada por aporte novo, então ele é
   * o quanto o resto precisa crescer para a classe voltar ao lugar.
   */
  rebalanceAmount: number
  assets: AllocationAsset[]
}

export type Allocation = {
  totalValue: number
  /** Soma das metas cadastradas. Diferente de 100 vira aviso na tela, não erro. */
  totalTarget: number
  classes: AllocationClass[]
}

/**
 * Monta a alocação a partir das classes cadastradas e dos ativos com posição.
 *
 * O balde "Sem classe" só aparece quando tem ativo, e aparece no topo: ele não tem meta
 * para perseguir, então não entra na régua do aporte — é pendência de cadastro, e no fim
 * de uma lista longa ninguém a veria.
 */
export function buildAllocation(
  classes: readonly AllocationClassInput[],
  assets: readonly AllocationAssetInput[],
): Allocation {
  const totalValue = sum(assets.map((a) => a.marketValue))
  const known = new Set(classes.map((c) => c.id))
  const byClass = new Map<number | null, AllocationAssetInput[]>()

  for (const asset of assets) {
    // Classe apagada entre a leitura e o render cai no balde, em vez de sumir do total.
    const key = asset.classId !== null && known.has(asset.classId) ? asset.classId : null
    const list = byClass.get(key)
    if (list === undefined) byClass.set(key, [asset])
    else list.push(asset)
  }

  const buckets: AllocationClass[] = classes.map((c) =>
    buildClass(c.id, c.name, c.color, c.targetPercent, byClass.get(c.id) ?? [], totalValue),
  )

  const orphans = byClass.get(null) ?? []
  if (orphans.length > 0) {
    buckets.push(
      buildClass(UNCLASSIFIED.id, UNCLASSIFIED.name, UNCLASSIFIED.color, 0, orphans, totalValue),
    )
  }

  // A lista é a fila do próximo aporte: quem está mais abaixo da meta primeiro, quem já
  // passou dela no fim. O rebalanceamento é sempre por dinheiro novo, nunca por venda —
  // ordenar pela distância absoluta jogaria para o topo justamente a classe onde não se
  // deve pôr mais nada.
  buckets.sort((a, b) => {
    if ((a.id === null) !== (b.id === null)) return a.id === null ? -1 : 1
    return a.deviation - b.deviation || a.name.localeCompare(b.name, 'pt-BR')
  })

  return {
    totalValue,
    totalTarget: sum(classes.map((c) => c.targetPercent)),
    classes: buckets,
  }
}

function buildClass(
  id: number | null,
  name: string,
  color: string,
  targetPercent: number,
  assets: readonly AllocationAssetInput[],
  totalValue: number,
): AllocationClass {
  const currentValue = sum(assets.map((a) => a.marketValue))
  const currentPercent = percentOf(currentValue, totalValue)
  const deviation = currentPercent - targetPercent

  return {
    id,
    name,
    color,
    targetPercent,
    currentValue,
    currentPercent,
    deviation,
    distance: Math.abs(deviation),
    rebalanceAmount: (targetPercent / 100) * totalValue - currentValue,
    // Menor valor de mercado primeiro: a ponta da lista é onde mora a posição
    // pequena demais para mover a carteira, que é o que se decide reforçar ou encerrar.
    assets: [...assets]
      .sort((a, b) => a.marketValue - b.marketValue || a.ticker.localeCompare(b.ticker))
      .map((asset) => ({
        ticker: asset.ticker,
        name: asset.name,
        type: asset.type,
        marketValue: asset.marketValue,
        percentOfClass: percentOf(asset.marketValue, currentValue),
        percentOfTotal: percentOf(asset.marketValue, totalValue),
      })),
  }
}

/** Carteira zerada não divide por zero — devolve 0, e a tela mostra 0,00%. */
function percentOf(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
