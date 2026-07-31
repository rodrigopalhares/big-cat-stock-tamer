import type { Db } from '../../config/db.js'
import {
  type Allocation,
  type AllocationAssetInput,
  buildAllocation,
} from '../../domain/allocation.js'
import type { PortfolioService } from '../portfolio/portfolio.service.js'
import { type AssetClassView, toAssetClassView, type UnpricedAsset } from './allocation.schema.js'
import type { AssetClassService } from './asset-class.service.js'

export type AllocationData = {
  allocation: Allocation
  /** Todas as classes cadastradas, em ordem alfabética — o select de cada ativo. */
  classes: AssetClassView[]
  /**
   * Quem tem posição mas ficou sem cotação, e por isso está fora dos percentuais.
   *
   * O total da carteira ignora posição sem preço — é o mesmo critério do dashboard, e
   * mudar aqui daria dois patrimônios diferentes em duas telas. Só que na alocação a
   * omissão encolhe uma classe inteira em silêncio: o dia em que o CSV do Tesouro não
   * responde, cinco títulos somem e a meta de Renda Fixa parece muito mais longe do que
   * está. Por isso a lista sobe para a tela em vez de morrer aqui.
   */
  unpriced: UnpricedAsset[]
}

/**
 * Junta o valor de mercado que o PortfolioService calcula com a classe gravada em cada
 * ativo. A conta em si é do domínio; aqui só se busca e se casa uma coisa com a outra.
 */
export class AllocationService {
  constructor(
    private readonly db: Db,
    private readonly portfolio: PortfolioService,
    private readonly assetClasses: AssetClassService,
  ) {}

  /**
   * Alocação atual da carteira.
   *
   * [fetchQuotes] repassa para o portfólio a busca de cotação do dia — desligado, a
   * tela usa o último preço gravado, que é o que os testes querem.
   */
  async getAllocation(fetchQuotes = true): Promise<AllocationData> {
    const [assets, classes] = await Promise.all([
      this.db.asset.findMany(),
      this.assetClasses.list(),
    ])
    const positions = await this.portfolio.buildPositions(assets, fetchQuotes)
    const classIdByTicker = new Map(assets.map((a) => [a.ticker, a.assetClassId]))

    const inputs: AllocationAssetInput[] = []
    const unpriced: UnpricedAsset[] = []
    for (const position of positions) {
      // Posição encerrada continua na lista de posições por causa do resultado
      // realizado, mas não ocupa espaço na carteira — fora da alocação.
      const marketValue = position.currentValueBrl
      if (marketValue === null || marketValue <= 0) {
        if (position.quantity > 0) {
          unpriced.push({ ticker: position.ticker, name: position.name, type: position.type })
        }
        continue
      }

      inputs.push({
        ticker: position.ticker,
        name: position.name,
        type: position.type,
        classId: classIdByTicker.get(position.ticker) ?? null,
        marketValue,
      })
    }

    return {
      allocation: buildAllocation(classes.map(toAssetClassView), inputs),
      classes: classes.map(toAssetClassView),
      unpriced,
    }
  }
}
