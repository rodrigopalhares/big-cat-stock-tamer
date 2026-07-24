import type { FastifyError, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { isHttpError } from '../shared/http-error.js'

/**
 * Ponto único de tradução de erro para resposta. Decide o formato pelo pedido:
 * JSON para /api e Accept: application/json, HX-Redirect para HTMX, HTML no resto.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = isHttpError(error) ? error.statusCode : (error.statusCode ?? 500)

    if (status >= 500) request.log.error({ err: error }, 'erro não tratado')
    else request.log.warn({ err: error, status }, 'requisição rejeitada')

    const wantsJson =
      request.url.includes('/api') || request.headers.accept?.includes('application/json')

    if (wantsJson) {
      return reply.code(status).send({ error: error.message })
    }

    if (request.headers['hx-request']) {
      return reply.code(status).header('HX-Retarget', '#error-banner').send(error.message)
    }

    return reply.code(status).type('text/html; charset=utf-8').send(error.message)
  })
}

export const errorsPlugin = fp(plugin, { name: 'errors' })
