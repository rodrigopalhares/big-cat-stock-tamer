import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  notesDir: string
  close: () => Promise<void>
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const db = await createTestDb()
  const notesDir = mkdtempSync(join(tmpdir(), 'stocks-notas-'))
  const env = loadEnv({
    ...process.env,
    DATABASE_URL: ':memory:',
    LOG_LEVEL: 'silent',
    // Pasta temporária por harness: nota importada em teste não encosta em ./data.
    APP_NOTES_DIR: notesDir,
    ...overrides,
  })
  const container = buildContainer(db, env)
  const app = await buildApp({ env, db, container })
  await app.ready()

  return {
    app,
    db,
    container,
    notesDir,
    close: async () => {
      await app.close()
      await db.$disconnect()
      rmSync(notesDir, { recursive: true, force: true })
    },
  }
}
