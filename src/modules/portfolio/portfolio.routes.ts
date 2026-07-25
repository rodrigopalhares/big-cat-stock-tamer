import type { FastifyPluginAsync } from 'fastify'
import type { Container } from '../../container.js'
import { buildCdiChartLine, buildIbovChartLine } from '../../domain/chart.js'
import { monthLabel } from '../../shared/format.js'
import { HttpError } from '../../shared/http-error.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { type ChartData, DashboardPage } from '../../views/pages/dashboard.js'
import type { AssetPosition } from './portfolio.schema.js'

/** Porte de src/main/kotlin/com/stocks/controller/PortfolioController.kt. */
export function portfolioRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/portfolio/', async (_req, reply) => {
      const assets = await c.db.asset.findMany()
      const positions = sortPositions(await c.portfolio.buildPositions(assets, true))
      const summary = c.portfolio.aggregatePositions(positions)

      const usdPosition = positions.find((p) => p.currency === 'USD' && p.exchangeRate !== null)

      return reply.html(
        DashboardPage({
          positions,
          assetTypes: [...new Set(positions.map((p) => p.type).filter(isString))].sort(),
          totalInvested: summary.totalInvested,
          realizedPnl: summary.realizedPnl,
          currentValue: summary.currentValue,
          unrealizedPnl: summary.unrealizedPnl,
          dividendPnl: summary.dividendPnl,
          irrAnnual: summary.irrAnnual,
          irrMonthly: summary.irrMonthly,
          hasUsd: positions.some((p) => p.currency === 'USD'),
          usdRate: usdPosition?.exchangeRate ?? null,
          chart: await buildChart(c),
        }),
      )
    })

    app.post('/portfolio/update-prices', async (_req, reply) => {
      await c.priceHistory.runDailyUpdate()
      return reply.type('text/html; charset=utf-8').send('')
    })

    app.get('/portfolio/api', async () => {
      const assets = await c.db.asset.findMany()
      const positions = await c.portfolio.buildPositions(assets, true)
      return c.portfolio.aggregatePositions(positions)
    })

    app.get<{ Params: { ticker: string } }>('/portfolio/api/:ticker', async (req) => {
      const asset = await c.db.asset.findUnique({
        where: { ticker: req.params.ticker.toUpperCase() },
      })
      if (asset === null) throw HttpError.notFound('Asset not found')

      const positions = await c.portfolio.buildPositions([asset], true)
      const position = positions[0]
      if (position === undefined) {
        throw HttpError.notFound('No transactions found for this asset')
      }
      return position
    })
  }
}

/**
 * Dados do gráfico: uma série por tipo de ativo, mais as linhas de referência.
 * Null quando não há snapshot nenhum — aí a página nem desenha o gráfico.
 */
async function buildChart(c: Container): Promise<ChartData | null> {
  const evolution = await c.evolution.getEvolution()
  if (evolution.months.length === 0) return null

  const assets = await c.db.asset.findMany({ select: { ticker: true, type: true } })
  const typeByTicker = new Map(assets.map((a) => [a.ticker, a.type ?? 'STOCK']))
  const types = [...new Set(typeByTicker.values())].sort()

  const invested = evolution.months.map((row) => row.totalInvested)
  const months = evolution.months.map((row) => row.month)

  const [ibovPrices, cdiAnnual] = await Promise.all([
    c.benchmarks.getMonthlyPricesMap(),
    c.benchmarks.fetchCdiAnnualRate(),
  ])

  return {
    labels: months.map((month) => monthLabel(month)),
    datasets: types.map((type) => ({
      label: type,
      data: evolution.months.map((row) =>
        row.snapshots
          .filter((s) => typeByTicker.get(s.assetId) === type)
          .reduce((total, s) => total + s.marketValue, 0),
      ),
    })),
    invested,
    ibov: buildIbovChartLine(months as IsoDate[], invested, ibovPrices),
    cdi: buildCdiChartLine(invested, cdiAnnual),
  }
}

function sortPositions(positions: AssetPosition[]): AssetPosition[] {
  return [...positions].sort(
    (a, b) => (a.type ?? '').localeCompare(b.type ?? '') || a.ticker.localeCompare(b.ticker),
  )
}

function isString(value: string | null): value is string {
  return value !== null
}
