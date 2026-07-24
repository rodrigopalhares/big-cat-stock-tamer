import { buildApp } from './app.js'
import { createDb } from './config/db.js'
import { loadEnv } from './config/env.js'

process.loadEnvFile('.env')

const env = loadEnv()
const db = await createDb(env)
const app = await buildApp({ env, db })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0))
  })
}

await app.listen({ port: env.PORT, host: '0.0.0.0' })
