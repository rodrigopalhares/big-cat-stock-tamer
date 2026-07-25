import { join } from 'node:path'
import formbody from '@fastify/formbody'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Db } from './config/db.js'
import type { Env } from './config/env.js'
import { buildContainer, type Container } from './container.js'
import { assetRoutes } from './modules/asset/asset.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { dividendRoutes } from './modules/dividend/dividend.routes.js'
import { evolutionRoutes } from './modules/evolution/evolution.routes.js'
import { portfolioRoutes } from './modules/portfolio/portfolio.routes.js'
import { riskRoutes } from './modules/risk/risk.routes.js'
import { transactionRoutes } from './modules/transaction/transaction.routes.js'
import { authPlugin } from './plugins/auth.js'
import { errorsPlugin } from './plugins/errors.js'
import { viewsPlugin } from './plugins/views.js'

export type AppDeps = {
  env: Env
  db: Db
  /** Permite injetar um container já montado nos testes. */
  container?: Container
}

/**
 * Monta a instância do Fastify sem subir servidor — é o que os testes usam
 * com `app.inject()`, o equivalente do MockMvc.
 */
export async function buildApp({ env, db, container }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  })

  const c = container ?? buildContainer(db, env)

  // Os formulários da aplicação são todos form-urlencoded; o Fastify só trata JSON por padrão.
  await app.register(formbody)
  await app.register(viewsPlugin)
  await app.register(authPlugin, { auth: c.auth })
  await app.register(errorsPlugin)

  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/',
    decorateReply: false,
  })

  // Era o addRedirectViewController do WebConfig.
  app.get('/', async (_req, reply) => reply.redirect('/portfolio/', 302))

  app.get('/health', async () => {
    await db.$queryRawUnsafe('SELECT 1')
    return { status: 'ok' }
  })

  await app.register(authRoutes(c, env.APP_AUTH_SESSION_DAYS))
  await app.register(assetRoutes(c))
  await app.register(portfolioRoutes(c))
  await app.register(evolutionRoutes(c))
  await app.register(riskRoutes(c))
  await app.register(transactionRoutes(c))
  await app.register(dividendRoutes(c))

  return app
}
