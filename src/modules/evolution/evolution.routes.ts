import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { EvolutionPage, EvolutionRows } from '../../views/pages/evolution.js'
import type { AssetPosition } from '../portfolio/portfolio.schema.js'
import type { MonthlyEvolutionRow } from './evolution.schema.js'
import { buildEvolutionChart } from './evolution-chart.js'

/** Porte de src/main/kotlin/com/stocks/controller/MonthlyEvolutionController.kt. */

/** Meses por página da rolagem infinita — três anos. */
const MONTHS_PAGE = 36

const RowsQuery = z.object({ offset: z.coerce.number().int().nonnegative().default(0) })

/** Do mais recente para o mais antigo: o mês atual é o que se quer ver primeiro. */
function newestFirst(months: readonly MonthlyEvolutionRow[]): MonthlyEvolutionRow[] {
  return [...months].reverse()
}

function nextRowsUrl(offset: number, total: number): string | null {
  return offset < total ? `/evolution/rows?offset=${offset}` : null
}

export function evolutionRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/evolution/', async (_req, reply) => {
      const summary = await c.evolution.getEvolution()
      const months = newestFirst(summary.months)
      const chart =
        months.length === 0 ? null : await buildEvolutionChart(c, await positions(c), summary)

      return reply.html(
        EvolutionPage({
          months: months.slice(0, MONTHS_PAGE),
          tickers: summary.currentTickers,
          total: months.length,
          nextUrl: nextRowsUrl(MONTHS_PAGE, months.length),
          chart,
        }),
      )
    })

    /** Próxima página da rolagem infinita: só as linhas, com a sentinela seguinte no fim. */
    app.get('/evolution/rows', async (req, reply) => {
      const { offset } = RowsQuery.parse(req.query)
      const summary = await c.evolution.getEvolution()
      const months = newestFirst(summary.months)

      return reply.partial(
        EvolutionRows({
          months: months.slice(offset, offset + MONTHS_PAGE),
          tickers: summary.currentTickers,
          nextUrl: nextRowsUrl(offset + MONTHS_PAGE, months.length),
        }),
      )
    })

    app.post('/evolution/recalculate', async (_req, reply) => {
      await c.evolution.recalculate()
      return reply.redirect('/evolution/', 302)
    })

    app.get('/evolution/api', async () => c.evolution.getEvolution())

    app.post('/evolution/api/recalculate', async () => {
      await c.evolution.recalculate()
      return { status: 'ok' }
    })
  }
}

/** As posições atuais alimentam as linhas de aporte e CDI do gráfico, como no dashboard. */
async function positions(c: Container): Promise<AssetPosition[]> {
  return c.portfolio.buildPositions(await c.db.asset.findMany(), true)
}
