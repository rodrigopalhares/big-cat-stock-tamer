import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { buildContainer, type Container } from '../src/container.js'
import { createTestDb, type TestDb } from './db.js'

/**
 * Sobe a aplicação inteira contra um banco em memória.
 * É o equivalente do @SpringBootTest + @AutoConfigureMockMvc, sem abrir porta.
 */
export type Harness = {
  app: FastifyInstance
  db: TestDb
  container: Container
  close: () => Promise<void>
}

export async function createHarness(): Promise<Harness> {
  const db = await createTestDb()
  const env = loadEnv({ ...process.env, DATABASE_URL: ':memory:', LOG_LEVEL: 'silent' })
  const container = buildContainer(db, env)
  const app = await buildApp({ env, db, container })
  await app.ready()

  return {
    app,
    db,
    container,
    close: async () => {
      await app.close()
      await db.$disconnect()
    },
  }
}
