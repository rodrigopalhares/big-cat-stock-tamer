import Fastify, { type FastifyInstance } from 'fastify'
import type { Db } from './config/db.js'
import type { Env } from './config/env.js'
import { errorsPlugin } from './plugins/errors.js'
import { viewsPlugin } from './plugins/views.js'

export type AppDeps = {
  env: Env
  db: Db
}

/**
 * Monta a instância do Fastify sem subir servidor — é o que os testes usam
 * com `app.inject()`, o equivalente do MockMvc.
 */
export async function buildApp({ env, db }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  })

  await app.register(viewsPlugin)
  await app.register(errorsPlugin)

  // Era o addRedirectViewController do WebConfig.
  app.get('/', async (_req, reply) => reply.redirect('/portfolio/', 302))

  app.get('/health', async () => {
    await db.$queryRawUnsafe('SELECT 1')
    return { status: 'ok' }
  })

  return app
}
