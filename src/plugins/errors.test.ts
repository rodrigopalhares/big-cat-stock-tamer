import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HttpError } from '../shared/http-error.js'
import { errorsPlugin } from './errors.js'
import { viewsPlugin } from './views.js'

/**
 * Mensagem de erro carrega entrada do usuário, então é aqui que um payload volta executável
 * se o escape sumir — no ramo HTMX, o único em que texto vira HTML sem passar por JSX.
 */
const XSS = '<svg onload=alert(1)>'
const MESSAGE = `Já existe uma classe chamada '${XSS}'.`

const Form = z.object({ quantity: z.coerce.number(), ticker: z.string().min(1) })

describe('errorsPlugin', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify({ logger: false })
    await app.register(viewsPlugin)
    await app.register(errorsPlugin)
    app.get('/boom', async () => {
      throw HttpError.conflict(MESSAGE)
    })
    app.get('/api/boom', async () => {
      throw HttpError.conflict(MESSAGE)
    })
    app.post('/form', async (req) => Form.parse(req.body))
    app.post('/target', async (req) =>
      z
        .object({ target_percent: z.coerce.number().min(0, 'Meta não pode ser negativa') })
        .parse(req.body),
    )
    app.get('/crash', async () => {
      throw new Error('Conversão não suportada')
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('página HTML', () => {
    it('tem layout, título por status e a mensagem escapada', async () => {
      const res = await app.inject({ method: 'GET', url: '/boom' })

      expect(res.statusCode).toBe(409)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.body).toContain('<!DOCTYPE html>')
      expect(res.body).toContain('Conflito')
      expect(res.body).toContain('Erro 409')
      // O JSX escapa `<` (e `&`, `"`), não `>`: a tag não sobrevive, e é isso que importa.
      expect(res.body).toContain('&lt;svg onload=alert(1)')
      expect(res.body).not.toContain(XSS)
    })

    it('"Voltar" aponta para o Referer quando ele é caminho interno', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/boom',
        headers: { referer: 'http://localhost:8000/transactions/?ticker=PETR4' },
      })

      expect(res.body).toContain('href="/transactions/?ticker=PETR4"')
    })

    it('sem Referer, ou com Referer que não é caminho, "Voltar" vai para o dashboard', async () => {
      const plain = await app.inject({ method: 'GET', url: '/boom' })
      expect(plain.body).toContain('href="/portfolio/" class="btn btn-primary"')

      const weird = await app.inject({
        method: 'GET',
        url: '/boom',
        headers: { referer: 'não é url' },
      })
      expect(weird.body).toContain('href="/portfolio/" class="btn btn-primary"')
    })

    it('rota inexistente vira 404 em página, não JSON do Fastify', async () => {
      const res = await app.inject({ method: 'GET', url: '/nada' })

      expect(res.statusCode).toBe(404)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.body).toContain('Esta página não existe.')
    })

    it('erro sem status vira 500 com título genérico e aviso do log', async () => {
      const res = await app.inject({ method: 'GET', url: '/crash' })

      expect(res.statusCode).toBe(500)
      expect(res.body).toContain('Erro inesperado')
      expect(res.body).toContain('ficou no log')
    })
  })

  describe('ZodError', () => {
    it('vira 400 com uma frase em português por campo', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/form',
        payload: { quantity: 'abc', ticker: '' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Dados inválidos')
      expect(res.body).toContain('Quantidade deve ser um número')
      expect(res.body).toContain('Ticker é obrigatório')
      expect(res.body).toContain('Nada foi gravado')
      expect(res.body).not.toContain('invalid_type')
    })

    it('mensagem escrita no schema vai inteira, sem prefixo de campo', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/target',
        headers: { accept: 'application/json' },
        payload: { target_percent: '-5' },
      })

      expect(res.json()).toEqual({
        error: 'Confira os campos abaixo.',
        details: ['Meta não pode ser negativa'],
      })
    })

    it('no ramo JSON devolve a lista de detalhes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/form',
        headers: { accept: 'application/json' },
        payload: { quantity: 'abc', ticker: 'PETR4' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'Confira os campos abaixo.',
        details: ['Quantidade deve ser um número'],
      })
    })
  })

  /**
   * O HTMX injeta o corpo no DOM como HTML qualquer que seja o content-type, então trocar o
   * tipo da resposta não protegeria este ramo — só o escape protege.
   */
  it('escapa a mensagem no ramo HTMX, mantendo o HX-Retarget', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'hx-request': 'true' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.headers['hx-retarget']).toBe('#error-banner')
    expect(res.body).toContain('&lt;svg onload=alert(1)&gt;')
    expect(res.body).not.toContain(XSS)
    expect(res.body).not.toContain('<!DOCTYPE')
  })

  it('o ramo JSON devolve a mensagem intacta — quem serializa é o Fastify', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/boom' })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: MESSAGE })
  })
})
