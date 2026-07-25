import type { FastifyPluginAsync } from 'fastify'
import type { Container } from '../../container.js'
import { EvolutionPage } from '../../views/pages/evolution.js'

/** Porte de src/main/kotlin/com/stocks/controller/MonthlyEvolutionController.kt. */
export function evolutionRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/evolution/', async (_req, reply) => {
      const summary = await c.evolution.getEvolution()
      return reply.html(EvolutionPage(summary))
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
