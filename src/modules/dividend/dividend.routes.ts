import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { isoDate, today as todayIso } from '../../shared/iso-date.js'
import { TransactionTickerInfo } from '../../views/components/ticker-info.js'
import { DividendsPage } from '../../views/pages/dividends.js'
import { DividendCsvPreview } from '../../views/partials/dividend-csv-preview.js'
import type { DividendBatchRowRequest } from '../csv-import/csv-import.service.js'
import {
  DividendApiRequest,
  DividendEditForm,
  DividendForm,
  toDividendResponse,
  toDividendView,
} from './dividend.schema.js'

/** Porte de src/main/kotlin/com/stocks/controller/DividendController.kt. */

const ListQuery = z.object({ ticker: z.string().nullish(), type: z.string().nullish() })
const CsvForm = z.object({ csv: z.string().default('') })
const BatchBody = z.object({ rows: z.array(z.custom<DividendBatchRowRequest>()) })

export function dividendRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/dividends/ticker-info', async (req, reply) => {
      const { ticker } = z.object({ ticker: z.string().default('') }).parse(req.query)
      const result = await c.transactions.lookupTickerInfo(ticker)
      if (result.ticker.length < 3) return reply.type('text/html; charset=utf-8').send('')
      return reply.partial(TransactionTickerInfo({ result }))
    })

    app.get('/dividends/', async (req, reply) => {
      const query = ListQuery.parse(req.query)
      const selectedTicker = query.ticker ? query.ticker.toUpperCase() : null

      const [dividends, assets] = await Promise.all([
        c.dividends.listDividends(selectedTicker, query.type),
        c.db.asset.findMany({ select: { ticker: true, name: true }, orderBy: { ticker: 'asc' } }),
      ])

      return reply.html(
        DividendsPage({
          dividends: dividends.map(toDividendView),
          assets: assets.map((a) => ({ ticker: a.ticker, name: a.name ?? '' })),
          selectedTicker,
          selectedType: query.type ?? '',
          today: todayIso(),
        }),
      )
    })

    app.post('/dividends/new', async (req, reply) => {
      const form = DividendForm.parse(req.body)
      await c.dividends.createDividend(form.ticker, {
        type: form.type,
        date: isoDate(form.date),
        totalAmount: form.total_amount,
        taxWithheld: form.tax_withheld,
        notes: form.notes,
        broker: form.broker,
        currency: form.currency,
      })
      return reply.redirect('/dividends/', 302)
    })

    app.post<{ Params: { id: string } }>('/dividends/:id/edit', async (req, reply) => {
      const form = DividendEditForm.parse(req.body)
      await c.dividends.updateDividend(Number(req.params.id), {
        type: form.type,
        date: isoDate(form.date),
        totalAmount: form.total_amount,
        taxWithheld: form.tax_withheld,
        notes: form.notes,
        broker: form.broker,
        currency: form.currency,
      })
      return reply.redirect(form.returnTo ?? '/dividends/', 302)
    })

    app.post<{ Params: { id: string } }>('/dividends/:id/delete', async (req, reply) => {
      const { returnTo } = z.object({ returnTo: z.string().optional() }).parse(req.body ?? {})
      await c.dividends.deleteDividend(Number(req.params.id))
      return reply.redirect(returnTo ?? '/dividends/', 302)
    })

    app.post('/dividends/parse-csv', async (req, reply) => {
      const { csv } = CsvForm.parse(req.body)
      const rows = await c.csvImport.parseDividendCsv(csv)
      return reply.partial(DividendCsvPreview({ rows }))
    })

    app.post('/dividends/batch', async (req) => {
      const body = BatchBody.parse(req.body)
      return { inserted: await c.csvImport.batchImportDividends(body.rows) }
    })

    // --- JSON ---

    app.get('/dividends/api', async (req) => {
      const query = ListQuery.parse(req.query)
      const dividends = await c.dividends.listDividends(query.ticker, query.type)
      return dividends.map(toDividendResponse)
    })

    app.post('/dividends/api', async (req, reply) => {
      const request = DividendApiRequest.parse(req.body)
      const dividend = await c.dividends.createDividend(request.ticker, {
        type: request.type,
        date: isoDate(request.date),
        totalAmount: request.totalAmount,
        taxWithheld: request.taxWithheld,
        notes: request.notes,
        broker: request.broker,
        currency: request.currency,
      })
      return reply.code(201).send(toDividendResponse(dividend))
    })

    app.delete<{ Params: { id: string } }>('/dividends/api/:id', async (req, reply) => {
      await c.dividends.deleteDividend(Number(req.params.id))
      return reply.code(204).send()
    })
  }
}
