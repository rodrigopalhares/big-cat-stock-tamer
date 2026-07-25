import type { FastifyPluginAsync } from 'fastify'
import type { Container } from '../../container.js'
import { RiskMetricsPage } from '../../views/pages/risk-metrics.js'

/** Porte de src/main/kotlin/com/stocks/controller/RiskMetricsController.kt. */
export function riskRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/risk-metrics/', async (_req, reply) => {
      const summary = await c.riskMetrics.getSummary()
      return reply.html(RiskMetricsPage(summary))
    })

    app.post('/risk-metrics/recalculate', async (_req, reply) => {
      await c.riskMetrics.recalculate()
      // O botão recarrega a página no sucesso; o corpo não é usado.
      return reply.type('text/html; charset=utf-8').send('')
    })
  }
}
