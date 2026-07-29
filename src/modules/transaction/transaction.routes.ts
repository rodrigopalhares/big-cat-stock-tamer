import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { HttpError } from '../../shared/http-error.js'
import { isoDate, today as todayIso } from '../../shared/iso-date.js'
import { TransactionTickerInfo } from '../../views/components/ticker-info.js'
import { TransactionsPage } from '../../views/pages/transactions.js'
import { BrokerNotePreview } from '../../views/partials/broker-note-preview.js'
import { CsvAssetReview } from '../../views/partials/csv-asset-review.js'
import { CsvPreview } from '../../views/partials/csv-preview.js'
import type { BrokerNoteFile } from '../broker-note/broker-note.service.js'
import type { AssetBatchRow, BatchRowRequest } from '../csv-import/csv-import.service.js'
import {
  TransactionApiRequest,
  TransactionEditForm,
  TransactionForm,
  toTransactionResponse,
  toTransactionView,
} from './transaction.schema.js'

/** Porte de src/main/kotlin/com/stocks/controller/TransactionController.kt. */

const ListQuery = z.object({
  ticker: z.string().nullish(),
  type: z.string().nullish(),
  position: z.string().nullish(),
})

const CsvForm = z.object({ csv: z.string().default('') })

const BatchImportBody = z.object({
  rows: z.array(z.custom<BatchRowRequest>()),
  assets: z.array(z.custom<AssetBatchRow>()).nullish(),
  brokerNoteId: z.number().int().positive().nullish(),
})

const IdParam = z.object({ id: z.coerce.number().int().positive() })

/** Id fora de forma é pedido malfeito, não erro interno — o `.parse()` cru viraria 500. */
function noteId(params: unknown): number {
  const parsed = IdParam.safeParse(params)
  if (!parsed.success) throw HttpError.badRequest('Id de nota inválido')
  return parsed.data.id
}

/** O nome do arquivo vem do banco, nunca da URL — não há caminho para o usuário forjar. */
function download(reply: FastifyReply, file: BrokerNoteFile): FastifyReply {
  return reply
    .type(file.contentType)
    .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
    .send(file.content)
}

export function transactionRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    // --- HTMX ---

    app.get('/transactions/ticker-info', async (req, reply) => {
      const { ticker } = z.object({ ticker: z.string().default('') }).parse(req.query)
      const result = await c.transactions.lookupTickerInfo(ticker)
      if (result.ticker.length < 3) return reply.type('text/html; charset=utf-8').send('')
      return reply.partial(TransactionTickerInfo({ result }))
    })

    app.get('/transactions/asset-info', async (req) => {
      const { ticker } = z.object({ ticker: z.string() }).parse(req.query)
      const info = await c.yahoo.fetchAssetInfo(ticker)
      return { name: info.name, type: info.type, yfTicker: info.yfTicker, currency: info.currency }
    })

    // --- HTML ---

    app.get('/transactions/', async (req, reply) => {
      const query = ListQuery.parse(req.query)
      const selectedTicker = query.ticker ? query.ticker.toUpperCase() : null

      const [transactions, assets] = await Promise.all([
        c.transactions.listTransactions({
          ticker: selectedTicker,
          type: query.type,
          position: query.position,
        }),
        c.db.asset.findMany({ select: { ticker: true, name: true }, orderBy: { ticker: 'asc' } }),
      ])

      return reply.html(
        TransactionsPage({
          transactions: transactions.map(toTransactionView),
          assets: assets.map((a) => ({ ticker: a.ticker, name: a.name ?? '' })),
          selectedTicker,
          selectedType: query.type ?? '',
          selectedPosition: query.position ?? '',
          today: todayIso(),
          noteImportEnabled: c.brokerNotes.enabled,
        }),
      )
    })

    app.post('/transactions/new', async (req, reply) => {
      const form = TransactionForm.parse(req.body)
      const resolved = c.transactions.resolvePrice(
        form.type,
        form.price,
        form.total_price,
        form.fees,
        form.quantity,
      )

      await c.transactions.createTransaction(form.ticker, {
        type: form.type,
        quantity: form.quantity,
        price: resolved.price,
        fees: resolved.fees,
        date: isoDate(form.date),
        broker: form.broker,
        notes: form.notes,
        inputCurrency: form.currency,
      })
      await c.assets.refreshPositionFields(form.ticker)

      return reply.redirect('/transactions/', 302)
    })

    app.post<{ Params: { id: string } }>('/transactions/:id/edit', async (req, reply) => {
      const form = TransactionEditForm.parse(req.body)
      const assetId = await c.transactions.updateTransaction(Number(req.params.id), {
        type: form.type,
        quantity: form.quantity,
        price: form.price,
        fees: form.fees,
        date: isoDate(form.date),
        broker: form.broker,
        notes: form.notes,
        inputCurrency: form.currency,
      })
      await c.assets.refreshPositionFields(assetId)
      return reply.redirect(form.returnTo ?? '/transactions/', 302)
    })

    app.post<{ Params: { id: string } }>('/transactions/:id/delete', async (req, reply) => {
      const { returnTo } = z.object({ returnTo: z.string().optional() }).parse(req.body ?? {})
      const assetId = await c.transactions.deleteTransaction(Number(req.params.id))
      await c.assets.refreshPositionFields(assetId)
      return reply.redirect(returnTo ?? '/transactions/', 302)
    })

    // --- Importação de CSV ---

    app.post('/transactions/parse-csv', async (req, reply) => {
      const { csv } = CsvForm.parse(req.body)
      const rows = await c.csvImport.extractDistinctAssets(csv)
      return reply.partial(CsvAssetReview({ rows, rawCsv: csv }))
    })

    app.post('/transactions/parse-csv-step2', async (req, reply) => {
      const { csv } = CsvForm.parse(req.body)
      const rows = await c.csvImport.parseCsvWithAssetLookup(csv)
      return reply.partial(CsvPreview({ rows }))
    })

    // --- Importação de nota de negociação ---

    app.post('/transactions/parse-note', async (req, reply) => {
      const upload = await req.file()
      if (upload === undefined) throw HttpError.badRequest('Nenhum arquivo enviado.')

      const result = await c.brokerNotes.importNote({
        file: await upload.toBuffer(),
        fileName: upload.filename,
        contentType: upload.mimetype,
      })
      return reply.partial(BrokerNotePreview({ result }))
    })

    app.get<{ Params: { id: string } }>('/transactions/notes/:id', async (req, reply) => {
      return download(reply, await c.brokerNotes.readFile(noteId(req.params)))
    })

    app.get<{ Params: { id: string } }>('/transactions/notes/:id/csv', async (req, reply) => {
      return download(reply, await c.brokerNotes.readCsv(noteId(req.params)))
    })

    app.post('/transactions/batch', async (req) => {
      const body = BatchImportBody.parse(req.body)
      const inserted = await c.csvImport.batchImport(
        body.rows,
        body.assets ?? [],
        body.brokerNoteId ?? null,
      )

      // Recalcula a posição só dos ativos que a importação tocou.
      for (const ticker of new Set(body.rows.map((r) => r.ticker.trim().toUpperCase()))) {
        await c.assets.refreshPositionFields(ticker)
      }
      return { inserted }
    })

    // --- JSON ---

    app.get('/transactions/api', async (req) => {
      const { ticker } = z.object({ ticker: z.string().nullish() }).parse(req.query)
      const transactions = await c.transactions.listTransactions({ ticker })
      return transactions.map(toTransactionResponse)
    })

    app.post('/transactions/api', async (req, reply) => {
      const request = TransactionApiRequest.parse(req.body)
      const tx = await c.transactions.createTransactionForExistingAsset(request.assetId, {
        type: request.type,
        quantity: request.quantity,
        price: request.price,
        fees: request.fees,
        date: isoDate(request.date),
        broker: request.broker,
        notes: request.notes,
      })
      await c.assets.refreshPositionFields(request.assetId)
      return reply.code(201).send(toTransactionResponse(tx))
    })

    app.delete<{ Params: { id: string } }>('/transactions/api/:id', async (req, reply) => {
      const assetId = await c.transactions.deleteTransaction(Number(req.params.id))
      await c.assets.refreshPositionFields(assetId)
      return reply.code(204).send()
    })
  }
}
