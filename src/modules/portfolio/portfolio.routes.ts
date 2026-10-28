import type { FastifyPluginAsync } from 'fastify'
import type { Container } from '../../container.js'
import { buildMonthlyDividendSeries } from '../../domain/chart.js'
import { isQuoteStale, quotesAsOf } from '../../domain/price-history.js'
import type { Asset } from '../../generated/prisma/client.js'
import { monthLabel } from '../../shared/format.js'
import { HttpError } from '../../shared/http-error.js'
import { firstDayOf, today, yearMonth } from '../../shared/iso-date.js'
import {
  type ClassGroup,
  DashboardPage,
  type DividendChartData,
} from '../../views/pages/dashboard.js'
import type { ClassBucket } from '../allocation/allocation.schema.js'
import { buildEvolutionChart } from '../evolution/evolution-chart.js'
import type { AssetPosition } from './portfolio.schema.js'

/** Porte de src/main/kotlin/com/stocks/controller/PortfolioController.kt. */
export function portfolioRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/portfolio/', async (_req, reply) => {
      const [assets, buckets] = await Promise.all([c.db.asset.findMany(), c.assetClasses.buckets()])
      const positions = await c.portfolio.buildPositions(assets)
      const summary = c.portfolio.aggregatePositions(positions)

      const usdPosition = positions.find((p) => p.currency === 'USD' && p.exchangeRate !== null)
      const asOf = quotesAsOf(positions)

      return reply.html(
        DashboardPage({
          groups: groupByClass(c, positions, assets, buckets),
          netContribution: summary.netContribution,
          totalInvested: summary.totalInvested,
          realizedPnl: summary.realizedPnl,
          currentValue: summary.currentValue,
          unrealizedPnl: summary.unrealizedPnl,
          dividendPnl: summary.dividendPnl,
          irrAnnual: summary.irrAnnual,
          irrMonthly: summary.irrMonthly,
          hasUsd: positions.some((p) => p.currency === 'USD'),
          usdRate: usdPosition?.exchangeRate ?? null,
          quotesAsOf: asOf,
          quotesStale: asOf !== null && isQuoteStale(asOf, today()),
          cdi: await c.cdi.compare(summary),
          chart: await buildEvolutionChart(c, positions, await c.evolution.getEvolution()),
          dividendChart: await buildDividendChart(c, buckets),
        }),
      )
    })

    app.post('/portfolio/update-prices', async (_req, reply) => {
      // É o botão "vai buscar tudo que é externo": as telas só leem o banco, então sem ele
      // cotação, dólar e CDI só mudariam no job das 18:30.
      await c.priceHistory.runDailyUpdate()
      await c.exchangeRates.backfillFromBcb('USD', 'BRL')
      await c.cdi.runBackfill()
      return reply.type('text/html; charset=utf-8').send('')
    })

    app.get('/portfolio/api', async () => {
      const assets = await c.db.asset.findMany()
      const positions = await c.portfolio.buildPositions(assets)
      return c.portfolio.aggregatePositions(positions)
    })

    app.get<{ Params: { ticker: string } }>('/portfolio/api/:ticker', async (req) => {
      const asset = await c.db.asset.findUnique({
        where: { ticker: req.params.ticker.toUpperCase() },
      })
      if (asset === null) throw HttpError.notFound('Ativo não encontrado')

      const positions = await c.portfolio.buildPositions([asset])
      const position = positions[0]
      if (position === undefined) {
        throw HttpError.notFound('Este ativo não tem transações')
      }
      return position
    })
  }
}

/**
 * Proventos recebidos mês a mês, uma série por classe de alocação, na ordem e na cor da
 * tabela. Null quando não há provento nenhum — aí a página nem desenha o gráfico.
 */
async function buildDividendChart(
  c: Container,
  buckets: readonly ClassBucket[],
): Promise<DividendChartData | null> {
  const flows = await c.dividends.getNetFlowsByAssetClass()
  const series = buildMonthlyDividendSeries(flows, yearMonth(today()))
  if (series.months.length === 0) return null

  const dataByClass = new Map(series.datasets.map((d) => [d.label, d.data]))
  return {
    labels: series.months.map((month) => monthLabel(firstDayOf(month))),
    datasets: buckets.flatMap(({ name, color }) => {
      const data = dataByClass.get(name)
      return data === undefined ? [] : [{ label: name, color, data }]
    }),
    movingAverage: series.movingAverage,
  }
}

/**
 * As posições agrupadas pela classe de alocação, cada grupo com o resumo pela mesma conta do
 * total da carteira — inclusive a TIR, que sai dos fluxos do grupo e não da média das TIRs
 * individuais.
 *
 * Classes na ordem de `AssetClassService.buckets`; dentro da classe, por tipo e ticker, para
 * os badges iguais ficarem juntos. Classe sem posição não aparece.
 */
function groupByClass(
  c: Container,
  positions: readonly AssetPosition[],
  assets: readonly Asset[],
  buckets: readonly ClassBucket[],
): ClassGroup[] {
  const classIdByTicker = new Map(assets.map((a) => [a.ticker, a.assetClassId]))

  return buckets.flatMap(({ id, name }) => {
    const group = sortPositions(
      positions.filter((p) => (classIdByTicker.get(p.ticker) ?? null) === id),
    )
    if (group.length === 0) return []
    return [
      {
        key: id === null ? 'none' : String(id),
        name,
        positions: group,
        summary: c.portfolio.aggregatePositions(group),
      },
    ]
  })
}

function sortPositions(positions: AssetPosition[]): AssetPosition[] {
  return [...positions].sort(
    (a, b) => (a.type ?? '').localeCompare(b.type ?? '') || a.ticker.localeCompare(b.ticker),
  )
}
