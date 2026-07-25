import { buildApp } from './app.js'
import { createDb } from './config/db.js'
import { loadEnv } from './config/env.js'
import { buildContainer } from './container.js'
import { startScheduler } from './infra/scheduler.js'

process.loadEnvFile('.env')

const env = loadEnv()
const db = await createDb(env)
const container = buildContainer(db, env, appLogger())
const app = await buildApp({ env, db, container })
const scheduler = startScheduler({
  priceHistory: container.priceHistory,
  exchangeRates: container.exchangeRates,
  backup: container.backup,
  logger: appLogger(),
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop()
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0))
  })
}

await app.listen({ port: env.PORT, host: '0.0.0.0' })

/** Logger simples para os jobs; o do Fastify só existe dentro de requisição. */
function appLogger() {
  return {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
    error: (m: string) => console.error(m),
  }
}
