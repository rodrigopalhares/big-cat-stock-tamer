import type { Db } from '../../config/db.js'
import { calculatePosition, type TransactionData } from '../../domain/calculation.js'
import type { TransactionType } from '../../domain/constants.js'
import { resolveQuoteSymbol } from '../../domain/price-history.js'
import type { Asset, Transaction } from '../../generated/prisma/client.js'
import { HttpError } from '../../shared/http-error.js'
import type { IsoDate } from '../../shared/iso-date.js'
import type { AssetClassService } from '../allocation/asset-class.service.js'
import type { PriceHistoryService } from '../price-history/price-history.service.js'
import {
  type AssetFilters,
  type AssetView,
  type ParsedAssetRequest,
  toAssetView,
} from './asset.schema.js'

/** Porte de src/main/kotlin/com/stocks/service/AssetService.kt. */

export type AssetUpdateResult = {
  asset: AssetView
  /**
   * Preços regravados por a edição ter trocado o símbolo de cotação.
   * `null` — o símbolo não mudou, nada foi refeito.
   * `0` — mudou, mas a busca não trouxe nada: o histórico ficou como estava, e provavelmente
   * o símbolo novo está errado.
   */
  refetchedPrices: number | null
}

export class AssetService {
  constructor(
    private readonly db: Db,
    private readonly assetClasses: AssetClassService,
    private readonly priceHistory: PriceHistoryService,
  ) {}

  async findAll(): Promise<AssetView[]> {
    const assets = await this.db.asset.findMany({ orderBy: { ticker: 'asc' } })
    return assets.map(toAssetView)
  }

  async findFiltered(filters: AssetFilters): Promise<AssetView[]> {
    const { type, position, delisted } = filters

    const assets = await this.db.asset.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(position === 'with' ? { hasPosition: true } : {}),
        ...(position === 'without' ? { hasPosition: false } : {}),
        ...(delisted === 'active' ? { delisted: false } : {}),
        ...(delisted === 'delisted' ? { delisted: true } : {}),
      },
      orderBy: { ticker: 'asc' },
    })
    return assets.map(toAssetView)
  }

  async computeTickersWithPosition(): Promise<Set<string>> {
    const assets = await this.db.asset.findMany({
      where: { hasPosition: true },
      select: { ticker: true },
    })
    return new Set(assets.map((a) => a.ticker))
  }

  async findById(ticker: string): Promise<AssetView | null> {
    const asset = await this.db.asset.findUnique({ where: { ticker: ticker.toUpperCase() } })
    return asset === null ? null : toAssetView(asset)
  }

  async exists(ticker: string): Promise<boolean> {
    const count = await this.db.asset.count({ where: { ticker: ticker.toUpperCase() } })
    return count > 0
  }

  async create(request: ParsedAssetRequest): Promise<AssetView> {
    if (await this.exists(request.ticker)) {
      throw HttpError.conflict('Ticker already registered')
    }
    const type = request.type ?? 'STOCK'
    const asset = await this.db.asset.create({
      data: {
        ticker: request.ticker,
        yfTicker: request.yfTicker ?? null,
        name: request.name ?? null,
        type,
        currency: request.currency,
        // Nasce classificado pelo tipo; a tela de alocação corrige o que ficar torto.
        assetClassId: await this.assetClasses.defaultClassIdForType(type),
      },
    })
    return toAssetView(asset)
  }

  async update(
    ticker: string,
    fields: {
      name?: string | null
      type?: string | null
      yfTicker?: string | null
      currency?: string | null
      delisted: boolean
      /**
       * Ausente preserva a classe atual; `null` explícito tira a classe. O formulário
       * sempre manda o campo, então "sem classe" precisa ser distinguível de "não veio".
       */
      assetClassId?: number | null
    },
  ): Promise<AssetUpdateResult> {
    const normalized = ticker.toUpperCase()
    const current = await this.db.asset.findUnique({ where: { ticker: normalized } })
    if (current === null) throw HttpError.notFound('Asset not found')

    // Id inválido viraria erro de FK do Prisma, que sai como 500. Confere antes.
    if (fields.assetClassId !== undefined && fields.assetClassId !== null) {
      await this.assetClasses.requireExists(fields.assetClassId)
    }

    const asset = await this.db.asset.update({
      where: { ticker: normalized },
      data: {
        name: blankToNull(fields.name),
        type: fields.type || current.type,
        yfTicker: blankToNull(fields.yfTicker),
        currency: fields.currency ? fields.currency : current.currency,
        delisted: fields.delisted,
        ...(fields.assetClassId === undefined ? {} : { assetClassId: fields.assetClassId }),
      },
    })

    return {
      asset: toAssetView(asset),
      refetchedPrices: await this.refetchIfSymbolChanged(current, asset),
    }
  }

  /**
   * Refaz a série de preços quando a edição trocou o símbolo consultado nas fontes externas.
   *
   * A série é chaveada pelo ticker do cadastro, não pelo símbolo: sem isto, os preços do
   * papel antigo continuariam no histórico do ativo, misturados aos novos e sem nada que os
   * distinga. E ninguém os reescreveria — o `runBackfill` retoma do último preço gravado.
   *
   * Só o símbolo importa. Trocar ETF por BDR não muda de onde vem a cotação, e refazer a
   * série nesse caso seria uma busca inteira de cinco anos por nada.
   */
  private async refetchIfSymbolChanged(before: Asset, after: Asset): Promise<number | null> {
    const previous = resolveQuoteSymbol(before.ticker, before.yfTicker, before.type)
    const current = resolveQuoteSymbol(after.ticker, after.yfTicker, after.type)
    if (previous === current) return null

    return this.priceHistory.refetchAssetHistory(after.ticker)
  }

  async delete(ticker: string): Promise<void> {
    const normalized = ticker.toUpperCase()
    if (!(await this.exists(normalized))) throw HttpError.notFound('Asset not found')
    // As transações, proventos, preços e snapshots saem por ON DELETE CASCADE.
    await this.db.asset.delete({ where: { ticker: normalized } })
  }

  /** Recalcula quantidade, preço médio e resultado realizado de um ativo. */
  async refreshPositionFields(assetId: string): Promise<void> {
    const normalized = assetId.toUpperCase()
    const asset = await this.db.asset.findUnique({ where: { ticker: normalized } })
    if (asset === null) return

    const transactions = await this.db.transaction.findMany({ where: { assetId: normalized } })
    await this.db.asset.update({
      where: { ticker: normalized },
      data: positionFields(transactions),
    })
  }

  /**
   * Recalcula todos os ativos.
   *
   * O Kotlin percorria os ativos acessando `asset.transactions`, o que dispara uma query
   * por ativo (N+1). Aqui são duas queries, e os updates vão numa transação só.
   */
  async refreshAllPositionFields(): Promise<void> {
    const [assets, transactions] = await Promise.all([
      this.db.asset.findMany({ select: { ticker: true } }),
      this.db.transaction.findMany(),
    ])

    const byAsset = new Map<string, Transaction[]>()
    for (const tx of transactions) {
      const list = byAsset.get(tx.assetId)
      if (list === undefined) byAsset.set(tx.assetId, [tx])
      else list.push(tx)
    }

    await this.db.$transaction(
      assets.map((asset) =>
        this.db.asset.update({
          where: { ticker: asset.ticker },
          data: positionFields(byAsset.get(asset.ticker) ?? []),
        }),
      ),
    )
  }
}

/** Campos de posição derivados das transações. Lista vazia zera tudo. */
function positionFields(transactions: readonly Transaction[]) {
  if (transactions.length === 0) {
    return {
      hasPosition: false,
      quantity: 0,
      avgPrice: 0,
      avgPriceBrl: 0,
      totalCost: 0,
      totalCostBrl: 0,
      realizedPnl: 0,
      realizedPnlBrl: 0,
    }
  }

  const calc = calculatePosition(transactions.map(toTransactionData))
  return {
    hasPosition: calc.quantity > 0,
    quantity: calc.quantity,
    avgPrice: calc.avgPrice,
    avgPriceBrl: calc.avgPriceBrl,
    totalCost: calc.totalCost,
    totalCostBrl: calc.totalCostBrl,
    realizedPnl: calc.realizedPnl,
    realizedPnlBrl: calc.realizedPnlBrl,
  }
}

export function toTransactionData(tx: Transaction): TransactionData {
  return {
    type: tx.type as TransactionType,
    quantity: tx.quantity,
    price: tx.price,
    fees: tx.fees,
    date: tx.date as IsoDate,
    priceBrl: tx.priceBrl,
    feesBrl: tx.feesBrl,
  }
}

function blankToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value
}
