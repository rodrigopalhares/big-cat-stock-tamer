import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { HttpError } from '../../shared/http-error.js'
import { today as todayIso } from '../../shared/iso-date.js'
import { AssetTickerInfo } from '../../views/components/ticker-info.js'
import { AssetDetailPage } from '../../views/pages/asset-detail.js'
import { AssetsPage } from '../../views/pages/assets.js'
import { toDividendView } from '../dividend/dividend.schema.js'
import { toTransactionView } from '../transaction/transaction.schema.js'
import { AssetFilters, AssetRequest } from './asset.schema.js'

/** Porte de src/main/kotlin/com/stocks/controller/AssetController.kt. */

const TickerQuery = z.object({ ticker: z.string().default('') })

const PriceWarningQuery = z.object({ prices: z.string().optional(), ticker: z.string().optional() })

/**
 * Aviso do refetch que voltou vazio, propagado pelo redirect da edição.
 * Fica na rota, e não em campo do banco, porque é sobre a última ação — não sobre o ativo.
 */
function priceWarning(query: unknown): string | null {
  const parsed = PriceWarningQuery.safeParse(query)
  if (!parsed.success || parsed.data.prices !== 'none') return null

  const ticker = parsed.data.ticker ?? 'o ativo'
  return (
    `Nenhuma cotação encontrada para o novo código de ${ticker}. ` +
    'O histórico foi mantido como estava — confira se o código está certo.'
  )
}

const CreateForm = z.object({
  ticker: z.string(),
  name: z.string().default(''),
  type: z.string().default('STOCK'),
  yf_ticker: z.string().default(''),
  currency: z.string().default('BRL'),
})

const EditForm = z.object({
  name: z.string().default(''),
  type: z.string().default('STOCK'),
  yf_ticker: z.string().default(''),
  currency: z.string().default('BRL'),
  delisted: z.string().default('false'),
  // Vazio é "sem classe", que é diferente de "não mexer": o select sempre manda um valor.
  asset_class_id: z.string().default(''),
  returnTo: z.string().optional(),
})

export function assetRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    // --- HTMX ---

    app.get('/assets/ticker-info', async (req, reply) => {
      const { ticker } = TickerQuery.parse(req.query)
      const normalized = ticker.trim().toUpperCase()
      if (normalized.length < 3) return reply.type('text/html; charset=utf-8').send('')

      const exists = await c.assets.exists(normalized)
      const info = exists ? null : await c.assetInfo.fetchAssetInfo(normalized)
      return reply.partial(AssetTickerInfo({ ticker: normalized, info, exists }))
    })

    // --- HTML ---

    app.get('/assets/', async (req, reply) => {
      const filters = AssetFilters.parse(req.query)
      return reply.html(
        AssetsPage({
          assets: await c.assets.findFiltered(filters),
          classes: await c.assetClasses.listViews(),
          warning: priceWarning(req.query),
          selectedType: filters.type ?? '',
          selectedPosition: filters.position ?? '',
          selectedDelisted: filters.delisted ?? '',
        }),
      )
    })

    app.get<{ Params: { ticker: string } }>('/assets/:ticker', async (req, reply) => {
      const ticker = req.params.ticker.toUpperCase()
      const asset = await c.assets.findById(ticker)
      if (asset === null) throw HttpError.notFound('Asset not found')

      const [entity, transactions, dividends, classes] = await Promise.all([
        c.db.asset.findUniqueOrThrow({ where: { ticker } }),
        c.transactions.listTransactions({ ticker }),
        c.dividends.listDividends(ticker),
        c.assetClasses.listViews(),
      ])
      const positions = await c.portfolio.buildPositions([entity], false)

      return reply.html(
        AssetDetailPage({
          asset,
          classes,
          warning: priceWarning(req.query),
          position: positions[0] ?? null,
          transactions: transactions.map(toTransactionView),
          dividends: dividends.map(toDividendView),
          today: todayIso(),
        }),
      )
    })

    app.post('/assets/new', async (req, reply) => {
      const form = CreateForm.parse(req.body)
      const ticker = form.ticker.trim().toUpperCase()

      if (await c.assets.exists(ticker)) {
        // Volta para a lista com o aviso, em vez de estourar erro.
        return reply.html(
          AssetsPage({
            assets: await c.assets.findAll(),
            classes: await c.assetClasses.listViews(),
            selectedType: '',
            selectedPosition: '',
            selectedDelisted: '',
            error: `Ativo '${ticker}' já cadastrado.`,
          }),
        )
      }

      // Sem nome informado, busca os dados no Yahoo.
      let { name, type, currency } = form
      let yfTicker = form.yf_ticker
      if (name.trim() === '') {
        const info = await c.assetInfo.fetchAssetInfo(ticker)
        name = info.name === ticker ? '' : info.name
        if (type.trim() === '') type = info.type
        if (yfTicker.trim() === '') yfTicker = info.yfTicker
        if (currency.trim() === '') currency = info.currency
      }

      await c.assets.create(
        AssetRequest.parse({
          ticker,
          yfTicker: yfTicker || null,
          name: name || null,
          type: type || 'STOCK',
          currency: currency || 'BRL',
        }),
      )
      return reply.redirect('/assets/', 302)
    })

    app.post<{ Params: { ticker: string } }>('/assets/:ticker/edit', async (req, reply) => {
      const form = EditForm.parse(req.body)
      const result = await c.assets.update(req.params.ticker, {
        name: form.name,
        type: form.type,
        yfTicker: form.yf_ticker,
        currency: form.currency,
        delisted: form.delisted === 'on' || form.delisted === 'true',
        assetClassId: form.asset_class_id === '' ? null : Number(form.asset_class_id),
      })

      // Símbolo trocado e busca vazia: o histórico ficou como estava, e quase sempre é
      // porque o símbolo novo não existe. Sem este aviso o usuário sai achando que corrigiu.
      const destination = form.returnTo ?? '/assets/'
      const query = result.refetchedPrices === 0 ? `?prices=none&ticker=${req.params.ticker}` : ''
      return reply.redirect(`${destination}${query}`, 302)
    })

    app.post<{ Params: { ticker: string } }>('/assets/:ticker/delete', async (req, reply) => {
      await c.assets.delete(req.params.ticker)
      return reply.redirect('/assets/', 302)
    })

    // --- JSON ---

    app.get('/assets/api', async () => c.assets.findAll())

    app.post('/assets/api', async (req, reply) => {
      const asset = await c.assets.create(AssetRequest.parse(req.body))
      return reply.code(201).send(asset)
    })

    app.get<{ Params: { ticker: string } }>('/assets/api/:ticker', async (req) => {
      const asset = await c.assets.findById(req.params.ticker)
      if (asset === null) throw HttpError.notFound('Asset not found')
      return asset
    })
  }
}
