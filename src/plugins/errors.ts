import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { ZodError } from 'zod'
import { escapeHtml } from '../shared/escape-html.js'
import { isHttpError } from '../shared/http-error.js'
import { internalPath } from '../shared/safe-redirect.js'
import { describeIssues } from '../shared/validation-message.js'
import { ErrorPage } from '../views/pages/error.js'

/**
 * Ponto único de tradução de erro para resposta. Decide o formato pelo pedido:
 * JSON para /api e Accept: application/json, HX-Retarget para HTMX, página HTML no resto.
 *
 * O ZodError é tratado aqui, e não rota a rota: campo inválido é pedido malfeito (400), e
 * os `issues` viram frases em português — em vez do array em inglês que saía como 500.
 *
 * O ramo HTMX escapa a mensagem: ela carrega entrada do usuário — o nome da classe em
 * asset-class.service.ts, o content-type do upload em anthropic.client.ts — e o HTMX injeta o
 * corpo no DOM como HTML, qualquer que seja o content-type. A página HTML passa pelo JSX, que
 * escapa sozinho; o ramo JSON é serializado pelo Fastify e `{ error }` nunca vira marcação.
 */

type Failure = {
  status: number
  title: string
  message: string
  details: string[]
}

const TITLES: Record<number, string> = {
  400: 'Dados inválidos',
  401: 'Acesso negado',
  403: 'Acesso negado',
  404: 'Não encontrado',
  409: 'Conflito',
  413: 'Arquivo grande demais',
  415: 'Formato não aceito',
  502: 'Serviço externo indisponível',
}

function describe(error: FastifyError): Failure {
  if (error instanceof ZodError) {
    return {
      status: 400,
      title: TITLES[400] ?? '',
      message: 'Confira os campos abaixo.',
      details: describeIssues(error.issues),
    }
  }
  const status = isHttpError(error) ? error.statusCode : (error.statusCode ?? 500)
  return {
    status,
    title: TITLES[status] ?? (status >= 500 ? 'Erro inesperado' : 'Pedido recusado'),
    message: error.message,
    details: [],
  }
}

function wantsJson(request: FastifyRequest): boolean {
  return (
    request.url.includes('/api') || (request.headers.accept?.includes('application/json') ?? false)
  )
}

/**
 * Para onde "Voltar" aponta: a página de onde o usuário veio, se for interna. O Referer é
 * cabeçalho do navegador, mas passa pelo mesmo filtro do `returnTo` — só caminho interno.
 */
function backHref(request: FastifyRequest): string {
  const referer = request.headers.referer
  if (typeof referer !== 'string') return '/portfolio/'
  try {
    const url = new URL(referer)
    return internalPath(`${url.pathname}${url.search}`, '/portfolio/')
  } catch {
    return '/portfolio/'
  }
}

function respond(request: FastifyRequest, reply: FastifyReply, failure: Failure): FastifyReply {
  const { status, message, details } = failure

  if (wantsJson(request)) {
    return reply
      .code(status)
      .send(details.length > 0 ? { error: message, details } : { error: message })
  }

  if (request.headers['hx-request']) {
    return reply
      .code(status)
      .header('HX-Retarget', '#error-banner')
      .send(escapeHtml([message, ...details].join(' ')))
  }

  // Formulário rejeitado: dizer que nada foi gravado poupa a dúvida de conferir a lista.
  const hint =
    request.method === 'POST' && status < 500
      ? 'Nada foi gravado. Volte, corrija e envie de novo.'
      : status >= 500
        ? 'O detalhe do erro ficou no log da aplicação.'
        : null

  return reply.code(status).html(
    ErrorPage({
      ...failure,
      hint,
      path: request.url,
      backHref: backHref(request),
    }),
  )
}

const plugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const failure = describe(error)

    if (failure.status >= 500) request.log.error({ err: error }, 'erro não tratado')
    else request.log.warn({ err: error, status: failure.status }, 'requisição rejeitada')

    return respond(request, reply, failure)
  })

  // Rota inexistente saía como JSON cru do Fastify, em inglês, em qualquer navegador.
  app.setNotFoundHandler((request, reply) =>
    respond(request, reply, {
      status: 404,
      title: TITLES[404] ?? '',
      message: 'Esta página não existe.',
      details: [],
    }),
  )
}

export const errorsPlugin = fp(plugin, { name: 'errors', dependencies: ['views'] })
