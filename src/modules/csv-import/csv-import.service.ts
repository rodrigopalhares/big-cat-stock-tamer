import type { Db } from '../../config/db.js'
import type { DividendCsvRow } from '../../domain/csv/dividend-csv.js'
import { parseDividendCsvRows } from '../../domain/csv/dividend-csv.js'
import {
  type AssetStatus,
  type CsvRow,
  extractDistinctTickers,
  parseCsvRows,
} from '../../domain/csv/transaction-csv.js'
import type { AssetInfoLookup } from '../../integrations/asset-info.client.js'
import { isoDate } from '../../shared/iso-date.js'
import type { DividendService } from '../dividend/dividend.service.js'
import type { TransactionService } from '../transaction/transaction.service.js'

/**
 * Importação em lote de transações e proventos.
 * Porte da parte de I/O de CsvParsingService.kt e DividendCsvParsingService.kt —
 * o parsing em si é puro e mora em src/domain/csv/.
 */

export type CsvAssetRow = {
  ticker: string
  name: string
  type: string
  yfTicker: string
  currency: string
  assetStatus: AssetStatus
}

export type AssetBatchRow = {
  ticker: string
  name: string
  type: string
  yfTicker: string
  currency: string
}

export type BatchRowRequest = {
  ticker: string
  date: string
  type: string
  quantity: number
  price: number
  fees: number
  broker: string
  notes: string
  currency: string
}

export type DividendBatchRowRequest = {
  ticker: string
  date: string
  type: string
  totalAmount: number
  taxWithheld: number
  currency: string
  broker: string
  notes: string
}

export class CsvImportService {
  constructor(
    private readonly db: Db,
    private readonly assetInfo: AssetInfoLookup,
    private readonly transactions: TransactionService,
    private readonly dividends: DividendService,
  ) {}

  /** Analisa o CSV colado, resolvendo no Yahoo os tickers ainda não cadastrados. */
  async parseCsvWithAssetLookup(rawCsv: string): Promise<CsvRow[]> {
    const existing = await this.existingTickers()

    // O parsing é síncrono, mas resolver ticker desconhecido não é: resolve antes,
    // depois passa um lookup puro para a função de domínio.
    const unknown = extractDistinctTickers(rawCsv).filter((t) => !existing.has(t))
    const statuses = new Map<string, AssetStatus>()
    for (const ticker of unknown) {
      const info = await this.assetInfo.fetchAssetInfo(ticker)
      statuses.set(ticker, info.name === ticker ? 'UNKNOWN' : 'WILL_CREATE')
    }

    return parseCsvRows(rawCsv, existing, (ticker) => statuses.get(ticker) ?? 'UNKNOWN')
  }

  /** Ativos distintos do CSV, com os dados que serão usados no cadastro. */
  async extractDistinctAssets(rawCsv: string): Promise<CsvAssetRow[]> {
    const tickers = extractDistinctTickers(rawCsv)
    const rows: CsvAssetRow[] = []

    for (const ticker of tickers) {
      const asset = await this.db.asset.findUnique({ where: { ticker } })
      if (asset !== null) {
        rows.push({
          ticker,
          name: asset.name ?? '',
          type: asset.type ?? 'STOCK',
          yfTicker: asset.yfTicker ?? '',
          currency: asset.currency,
          assetStatus: 'EXISTS',
        })
        continue
      }

      const info = await this.assetInfo.fetchAssetInfo(ticker)
      const found = info.name !== ticker
      rows.push({
        ticker,
        name: found ? info.name : '',
        type: found ? info.type : 'STOCK',
        yfTicker: info.yfTicker,
        currency: info.currency,
        assetStatus: found ? 'WILL_CREATE' : 'UNKNOWN',
      })
    }
    return rows
  }

  /**
   * Cadastra os ativos novos e insere as transações. Devolve quantas foram inseridas.
   *
   * [brokerNoteId] liga as transações à nota de negociação que as originou, quando o CSV
   * veio de um PDF importado — é o que dá o link de download na linha do histórico.
   */
  async batchImport(
    rows: readonly BatchRowRequest[],
    newAssets: readonly AssetBatchRow[] = [],
    brokerNoteId: number | null = null,
  ) {
    for (const asset of newAssets) {
      const ticker = asset.ticker.trim().toUpperCase()
      const exists = await this.db.asset.count({ where: { ticker } })
      if (exists === 0) {
        await this.db.asset.create({
          data: {
            ticker,
            yfTicker: asset.yfTicker || null,
            name: asset.name || null,
            type: asset.type || 'STOCK',
            currency: asset.currency || 'BRL',
          },
        })
      }
    }

    let inserted = 0
    for (const row of rows) {
      await this.transactions.createTransaction(row.ticker, {
        type: row.type,
        quantity: Math.abs(row.quantity),
        price: row.price,
        fees: row.fees,
        date: isoDate(row.date),
        broker: row.broker,
        notes: row.notes,
        inputCurrency: row.currency,
        brokerNoteId,
      })
      inserted++
    }
    return inserted
  }

  async parseDividendCsv(rawCsv: string): Promise<DividendCsvRow[]> {
    return parseDividendCsvRows(rawCsv, await this.existingTickers())
  }

  async batchImportDividends(rows: readonly DividendBatchRowRequest[]): Promise<number> {
    let inserted = 0
    for (const row of rows) {
      await this.dividends.createDividend(row.ticker, {
        type: row.type,
        date: isoDate(row.date),
        totalAmount: row.totalAmount,
        taxWithheld: row.taxWithheld,
        notes: row.notes,
        broker: row.broker,
        currency: row.currency || 'BRL',
      })
      inserted++
    }
    return inserted
  }

  private async existingTickers(): Promise<Set<string>> {
    const assets = await this.db.asset.findMany({ select: { ticker: true } })
    return new Set(assets.map((a) => a.ticker))
  }
}
