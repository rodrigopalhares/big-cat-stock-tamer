import type { FastifyPluginAsync } from 'fastify'
import type { Container } from '../../container.js'
import { UNCLASSIFIED } from '../../domain/allocation.js'
import { buildMonthlyDividendSeries } from '../../domain/chart.js'
import { isQuoteStale, quotesAsOf } from '../../domain/price-history.js'
import type { Asset, AssetClass } from '../../generated/prisma/client.js'
import { monthLabel } from '../../shared/format.js'
import { HttpError } from '../../shared/http-error.js'
import { firstDayOf, today, yearMonth } from '../../shared/iso-date.js'
import {
  type ClassGroup,
  DashboardPage,
  type DividendChartData,
} from '../../views/pages/dashboard.js'
import { buildEvolutionChart } from '../evolution/evolution-chart.js'
import type { AssetPosition } from './portfolio.schema.js'

/** Porte de src/main/kotlin/com/stocks/controller/PortfolioController.kt. */
export function portfolioRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/portfolio/', async (_req, reply) => {
      const [assets, classes] = await Promise.all([c.db.asset.findMany(), c.assetClasses.list()])
      const positions = await c.portfolio.buildPositions(assets)
      const summary = c.portfolio.aggregatePositions(positions)

      const usdPosition = positions.find((p) => p.currency === 'USD' && p.exchangeRate !== null)
      const asOf = quotesAsOf(positions)

      return reply.html(
        DashboardPage({
          groups: groupByClass(c, positions, assets, classes),
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
          dividendChart: await buildDividendChart(c),
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
 * Proventos recebidos mês a mês, uma série por tipo de ativo.
 * Null quando não há provento nenhum — aí a página nem desenha o gráfico.
 */
async function buildDividendChart(c: Container): Promise<DividendChartData | null> {
  const flows = await c.dividends.getNetFlowsByAssetType()
  const series = buildMonthlyDividendSeries(flows, yearMonth(today()))
  if (series.months.length === 0) return null

  return {
    labels: series.months.map((month) => monthLabel(firstDayOf(month))),
    datasets: series.datasets,
    movingAverage: series.movingAverage,
  }
}

/**
 * As posições agrupadas pela classe de alocação, cada grupo com o resumo pela mesma conta do
 * total da carteira — inclusive a TIR, que sai dos fluxos do grupo e não da média das TIRs
 * individuais.
 *
 * Classes em ordem alfabética e o balde "Sem classe" por último; dentro da classe, por tipo
 * e ticker, para os badges iguais ficarem juntos. Classe sem posição não aparece.
 */
function groupByClass(
  c: Container,
  positions: readonly AssetPosition[],
  assets: readonly Asset[],
  classes: readonly AssetClass[],
): ClassGroup[] {
  const classIdByTicker = new Map(assets.map((a) => [a.ticker, a.assetClassId]))
  const buckets = [
    ...[...classes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cls) => ({ id: cls.id as number | null, name: cls.name })),
    { id: UNCLASSIFIED.id, name: UNCLASSIFIED.name },
  ]
  const known = new Set(classes.map((cls) => cls.id))
  const classOf = (p: AssetPosition): number | null => {
    const id = classIdByTicker.get(p.ticker) ?? null
    return id !== null && known.has(id) ? id : null
  }

  return buckets.flatMap(({ id, name }) => {
    const group = sortPositions(positions.filter((p) => classOf(p) === id))
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
