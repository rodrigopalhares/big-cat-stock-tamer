import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError } from '../shared/http-error.js'
import { errorsPlugin } from './errors.js'

/**
 * O handler de erro é o único lugar da aplicação em que texto vira HTML sem passar por uma
 * view JSX. Mensagem de erro carrega entrada do usuário, então é aqui que um payload volta
 * executável se o escape sumir.
 */
const XSS = '<svg onload=alert(1)>'
const MESSAGE = `Já existe uma classe chamada '${XSS}'.`

describe('errorsPlugin', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify({ logger: false })
    await app.register(errorsPlugin)
    app.get('/boom', async () => {
      throw HttpError.conflict(MESSAGE)
    })
    app.get('/api/boom', async () => {
      throw HttpError.conflict(MESSAGE)
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('escapa a mensagem no ramo HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' })

    expect(res.statusCode).toBe(409)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('&lt;svg onload=alert(1)&gt;')
    expect(res.body).not.toContain(XSS)
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
  })

  it('o ramo JSON devolve a mensagem intacta — quem serializa é o Fastify', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/boom' })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: MESSAGE })
  })

  it('texto sem marcação chega inalterado', async () => {
    const plain = Fastify({ logger: false })
    await plain.register(errorsPlugin)
    plain.get('/boom', async () => {
      throw HttpError.badRequest('Meta não pode ser negativa')
    })
    await plain.ready()

    const res = await plain.inject({ method: 'GET', url: '/boom' })
    expect(res.body).toBe('Meta não pode ser negativa')
    await plain.close()
  })
})
