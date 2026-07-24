import { describe, expect, it } from 'vitest'
import { HttpResponse, http, server } from '../../tests/msw.js'
import { HttpClient } from './http.js'

const URL = 'https://exemplo.test/recurso'

describe('HttpClient', () => {
  it('devolve JSON em resposta ok', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ ok: true })))
    expect(await new HttpClient().getJson(URL)).toEqual({ ok: true })
  })

  it('devolve texto em resposta ok', async () => {
    server.use(http.get(URL, () => HttpResponse.text('conteúdo')))
    expect(await new HttpClient().getText(URL)).toBe('conteúdo')
  })

  it.each([400, 404, 500, 503])('devolve null em status %s, sem lançar', async (status) => {
    server.use(http.get(URL, () => new HttpResponse(null, { status })))
    expect(await new HttpClient().getJson(URL)).toBeNull()
  })

  it('devolve null quando o corpo não é JSON', async () => {
    server.use(http.get(URL, () => HttpResponse.text('isto não é json')))
    expect(await new HttpClient().getJson(URL)).toBeNull()
  })

  it('devolve null em erro de rede', async () => {
    server.use(http.get(URL, () => HttpResponse.error()))
    expect(await new HttpClient().getJson(URL)).toBeNull()
  })

  it('envia o User-Agent configurado', async () => {
    let received: string | null = null
    server.use(
      http.get(URL, ({ request }) => {
        received = request.headers.get('User-Agent')
        return HttpResponse.json({})
      }),
    )

    await new HttpClient({ userAgent: 'agente-teste' }).getJson(URL)
    expect(received).toBe('agente-teste')
  })

  it('registra a falha no logger em vez de lançar', async () => {
    server.use(http.get(URL, () => new HttpResponse(null, { status: 500 })))

    const warnings: string[] = []
    const client = new HttpClient({
      logger: { info: () => {}, warn: (m) => warnings.push(m), error: () => {} },
    })

    await client.getJson(URL)
    expect(warnings.some((w) => w.includes('500'))).toBe(true)
  })
})
