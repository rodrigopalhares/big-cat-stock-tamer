import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { RiskMetricsPage } from '../../views/pages/risk-metrics.js'

/** Sem parâmetro (ou com lixo na URL) a tela mostra só quem tem posição aberta. */
const PositionQuery = z.object({ position: z.enum(['with', 'all']).catch('with') })

/** Porte de src/main/kotlin/com/stocks/controller/RiskMetricsController.kt. */
export function riskRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    app.get('/risk-metrics/', async (req, reply) => {
      const { position } = PositionQuery.parse(req.query)
      const summary = await c.riskMetrics.getSummary(position)
      return reply.html(RiskMetricsPage({ ...summary, selectedPosition: position }))
    })

    app.post('/risk-metrics/recalculate', async (_req, reply) => {
      await c.riskMetrics.recalculate()
      // O botão recarrega a página no sucesso; o corpo não é usado.
      return reply.type('text/html; charset=utf-8').send('')
    })
  }
}
