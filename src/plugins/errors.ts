import type { FastifyError, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { escapeHtml } from '../shared/escape-html.js'
import { isHttpError } from '../shared/http-error.js'

/**
 * Ponto único de tradução de erro para resposta. Decide o formato pelo pedido:
 * JSON para /api e Accept: application/json, HX-Redirect para HTMX, HTML no resto.
 *
 * Os dois ramos de HTML escapam a mensagem. Ela carrega entrada do usuário — o nome da classe
 * em asset-class.service.ts, o content-type do upload em anthropic.client.ts — e este é o único
 * caminho da aplicação em que texto vira HTML sem passar por uma view JSX. O ramo JSON não
 * precisa: quem serializa é o Fastify, e `{ error }` nunca é interpretado como marcação.
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

    // O HTMX injeta o corpo no DOM como HTML, mesmo com outro content-type declarado — então
    // aqui o escape é obrigatório, não é o `type()` que protege.
    if (request.headers['hx-request']) {
      return reply
        .code(status)
        .header('HX-Retarget', '#error-banner')
        .send(escapeHtml(error.message))
    }

    return reply.code(status).type('text/html; charset=utf-8').send(escapeHtml(error.message))
  })
}

export const errorsPlugin = fp(plugin, { name: 'errors' })
