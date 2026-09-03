import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { HttpError } from '../../shared/http-error.js'
import { isoDate, today as todayIso } from '../../shared/iso-date.js'
import { internalPath } from '../../shared/safe-redirect.js'
import { pathWithQuery } from '../../shared/url.js'
import { TransactionTickerInfo } from '../../views/components/ticker-info.js'
import { DividendRows, DividendsPage } from '../../views/pages/dividends.js'
import { DividendCsvPreview } from '../../views/partials/dividend-csv-preview.js'
import type { DividendBatchRowRequest } from '../csv-import/csv-import.service.js'
import {
  DividendApiRequest,
  DividendEditForm,
  DividendForm,
  toDividendResponse,
  toDividendView,
} from './dividend.schema.js'
import type { DividendFilters } from './dividend.service.js'

/** Porte de src/main/kotlin/com/stocks/controller/DividendController.kt. */

const ListQuery = z.object({
  ticker: z.string().nullish(),
  q: z.string().nullish(),
  type: z.string().nullish(),
  assetType: z.string().nullish(),
  year: z.coerce.number().int().nullish(),
  offset: z.coerce.number().int().nonnegative().default(0),
})
type ListQuery = z.infer<typeof ListQuery>

/** Linhas por página da rolagem infinita. */
const PAGE_SIZE = 100

function filtersOf(query: ListQuery): DividendFilters {
  return {
    ticker: query.ticker ? query.ticker.toUpperCase() : null,
    search: query.q,
    type: query.type,
    assetType: query.assetType,
    // `year=` vazio vira 0 na coerção; 0 não é ano.
    year: query.year || null,
  }
}

/** URL da página que começa em [offset], com os mesmos filtros; null quando não há mais. */
function nextRowsUrl(query: ListQuery, offset: number, total: number): string | null {
  if (offset >= total) return null
  return pathWithQuery('/dividends/rows', {
    ticker: query.ticker,
    q: query.q,
    type: query.type,
    assetType: query.assetType,
    year: query.year || null,
    offset,
  })
}
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
      const filters = filtersOf(query)

      const [dividends, total, netTotalBrl, assets, assetTypes, years] = await Promise.all([
        c.dividends.listDividends(filters, { limit: PAGE_SIZE, offset: 0 }),
        c.dividends.countDividends(filters),
        c.dividends.sumNetDividendsBrl(filters),
        c.db.asset.findMany({ select: { ticker: true, name: true }, orderBy: { ticker: 'asc' } }),
        c.dividends.listAssetTypesWithDividends(),
        c.dividends.listYears(),
      ])

      return reply.html(
        DividendsPage({
          dividends: dividends.map(toDividendView),
          total,
          netTotalBrl,
          nextUrl: nextRowsUrl(query, PAGE_SIZE, total),
          assets: assets.map((a) => ({ ticker: a.ticker, name: a.name ?? '' })),
          assetTypes,
          selectedTicker: filters.ticker ?? null,
          selectedType: query.type ?? '',
          selectedAssetType: query.assetType ?? '',
          search: query.q ?? '',
          years,
          selectedYear: filters.year ?? null,
          today: todayIso(),
        }),
      )
    })

    /** Próxima página da rolagem infinita: só as linhas, com a sentinela seguinte no fim. */
    app.get('/dividends/rows', async (req, reply) => {
      const query = ListQuery.parse(req.query)
      const filters = filtersOf(query)

      const [dividends, total] = await Promise.all([
        c.dividends.listDividends(filters, { limit: PAGE_SIZE, offset: query.offset }),
        c.dividends.countDividends(filters),
      ])

      return reply.partial(
        DividendRows({
          dividends: dividends.map(toDividendView),
          nextUrl: nextRowsUrl(query, query.offset + PAGE_SIZE, total),
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
      return reply.redirect(internalPath(form.returnTo, '/dividends/'), 302)
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
      return reply.redirect(internalPath(form.returnTo, '/dividends/'), 302)
    })

    app.post<{ Params: { id: string } }>('/dividends/:id/delete', async (req, reply) => {
      const { returnTo } = z.object({ returnTo: z.string().optional() }).parse(req.body ?? {})
      await c.dividends.deleteDividend(Number(req.params.id))
      return reply.redirect(internalPath(returnTo, '/dividends/'), 302)
    })

    app.post('/dividends/parse-csv', async (req, reply) => {
      const { csv } = CsvForm.parse(req.body)
      const rows = await c.csvImport.parseDividendCsv(csv)
      return reply.partial(DividendCsvPreview({ rows }))
    })

    /**
     * Upload do extrato de Movimentação da B3. Devolve o mesmo fragmento do CSV — a única
     * diferença é o resumo do que foi descartado, para o total bater com o arquivo.
     */
    app.post('/dividends/parse-xlsx', async (req, reply) => {
      const upload = await req.file()
      if (upload === undefined) throw HttpError.badRequest('Nenhum arquivo enviado.')

      const file = await upload.toBuffer()
      const result = await parseSheet(c, new Uint8Array(file))
      return reply.partial(DividendCsvPreview({ rows: result.rows, discarded: result.discarded }))
    })

    app.post('/dividends/batch', async (req) => {
      const body = BatchBody.parse(req.body)
      return { inserted: await c.csvImport.batchImportDividends(body.rows) }
    })

    // --- JSON ---

    app.get('/dividends/api', async (req) => {
      const query = ListQuery.parse(req.query)
      const dividends = await c.dividends.listDividends(filtersOf(query))
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

/**
 * Arquivo que não é o extrato da B3 é erro do usuário, não falha do servidor: o leitor de
 * xlsx e a conferência do cabeçalho jogam `Error`, e sem isso viraria 500 sem explicação.
 */
async function parseSheet(c: Container, file: Uint8Array) {
  try {
    return await c.csvImport.parseB3MovimentacaoXlsx(file)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw HttpError.badRequest(error instanceof Error ? error.message : String(error))
  }
}
