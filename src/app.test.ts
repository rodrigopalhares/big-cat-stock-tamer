import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { createDb, type Db } from './config/db.js'
import { loadEnv } from './config/env.js'
import { HttpError } from './shared/http-error.js'

describe('app', () => {
  let app: FastifyInstance
  let db: Db

  beforeAll(async () => {
    const env = loadEnv({ ...process.env, DATABASE_URL: ':memory:', LOG_LEVEL: 'silent' })
    db = await createDb(env)
    app = await buildApp({ env, db })
    // Rotas só podem ser registradas antes do primeiro inject().
    app.get('/api/boom', async () => {
      throw HttpError.notFound('Asset not found')
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await db.$disconnect()
  })

  it('responde /health consultando o banco', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('redireciona / para /portfolio/', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/portfolio/')
  })

  it('traduz HttpError para JSON em rota de api', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/boom' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Asset not found' })
  })

  it('responde 404 para rota inexistente', async () => {
    const res = await app.inject({ method: 'GET', url: '/nao-existe' })
    expect(res.statusCode).toBe(404)
  })
})
