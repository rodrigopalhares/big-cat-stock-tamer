import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { loadEnv } from '../../src/config/env.js'
import { buildContainer } from '../../src/container.js'
import { SESSION_COOKIE } from '../../src/plugins/auth.js'
import { createTestDb, type TestDb } from '../db.js'

/**
 * Fluxo de login e proteção de rota.
 * Porte de AuthController.kt + AuthFilter.kt, que não tinham teste próprio no Kotlin.
 */
describe('autenticação', () => {
  let dir: string
  let db: TestDb
  let app: FastifyInstance

  async function start(password: string): Promise<void> {
    db = await createTestDb()
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: ':memory:',
      LOG_LEVEL: 'silent',
      APP_AUTH_PASSWORD: password,
      APP_AUTH_KEY_FILE: join(dir, 'auth.key'),
    })
    app = await buildApp({ env, db, container: buildContainer(db, env) })
    await app.ready()
  }

  const sessionFrom = (setCookie: string | string[] | undefined): string => {
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '')
    return raw.split(';')[0]?.split('=')[1] ?? ''
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auth-route-'))
  })

  afterEach(async () => {
    await app.close()
    await db.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('com senha configurada', () => {
    beforeEach(async () => {
      await start('segredo')
    })

    it('rota protegida sem sessão redireciona para o login', async () => {
      const res = await app.inject({ method: 'GET', url: '/assets/' })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/login')
    })

    it('requisição HTMX recebe 401 com HX-Redirect', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/assets/',
        headers: { 'hx-request': 'true' },
      })

      expect(res.statusCode).toBe(401)
      expect(res.headers['hx-redirect']).toBe('/login')
    })

    it('a página de login é pública', async () => {
      const res = await app.inject({ method: 'GET', url: '/login' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Acesso restrito')
    })

    it('os estáticos são públicos', async () => {
      const res = await app.inject({ method: 'GET', url: '/css/custom.css' })
      expect(res.statusCode).not.toBe(302)
    })

    it('senha correta cria a sessão e redireciona', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { password: 'segredo' },
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/portfolio/')
      expect(String(res.headers['set-cookie'])).toContain(SESSION_COOKIE)
      expect(String(res.headers['set-cookie'])).toContain('HttpOnly')
    })

    it('senha errada devolve 401 na própria página', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { password: 'errada' },
      })

      expect(res.statusCode).toBe(401)
      expect(res.body).toContain('Senha incorreta')
      expect(res.headers['set-cookie']).toBeUndefined()
    })

    it('com a sessão, a rota protegida abre', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { password: 'segredo' },
      })
      const token = sessionFrom(login.headers['set-cookie'])

      const res = await app.inject({
        method: 'GET',
        url: '/assets/',
        cookies: { [SESSION_COOKIE]: token },
      })

      expect(res.statusCode).toBe(200)
    })

    it('logout invalida a sessão', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { password: 'segredo' },
      })
      const token = sessionFrom(login.headers['set-cookie'])

      const logout = await app.inject({
        method: 'POST',
        url: '/logout',
        cookies: { [SESSION_COOKIE]: token },
      })
      expect(logout.headers.location).toBe('/login')

      const after = await app.inject({
        method: 'GET',
        url: '/assets/',
        cookies: { [SESSION_COOKIE]: token },
      })
      expect(after.statusCode).toBe(302)
    })

    it('cookie forjado não passa', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/assets/',
        cookies: { [SESSION_COOKIE]: 'inventado' },
      })

      expect(res.statusCode).toBe(302)
    })
  })

  describe('sem senha configurada', () => {
    beforeEach(async () => {
      await start('')
    })

    it('tudo fica aberto', async () => {
      const res = await app.inject({ method: 'GET', url: '/assets/' })
      expect(res.statusCode).toBe(200)
    })

    it('a tela de login redireciona para o dashboard', async () => {
      const res = await app.inject({ method: 'GET', url: '/login' })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/portfolio/')
    })
  })
})
