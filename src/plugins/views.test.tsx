import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { viewsPlugin } from './views.js'

function Badge({ kind, children }: { kind: 'ok' | 'warn'; children: string }) {
  return <span class={`badge bg-${kind === 'ok' ? 'success' : 'warning'}`}>{children}</span>
}

function Page({ tickers }: { tickers: string[] }) {
  return (
    <html lang="pt-BR">
      <body>
        {tickers.map((t) => (
          <div>
            {t}
            <Badge kind="warn">deslistado</Badge>
          </div>
        ))}
      </body>
    </html>
  )
}

async function buildTestApp() {
  const app = Fastify({ logger: false })
  await app.register(viewsPlugin)
  app.get('/page', async (_req, reply) => reply.html(<Page tickers={['PETR4', 'VALE3']} />))
  app.get('/partial', async (_req, reply) =>
    reply.partial(<Badge kind="ok">{'<script>alert(1)</script>'}</Badge>),
  )
  await app.ready()
  return app
}

describe('views', () => {
  it('renderiza página completa com doctype', async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/page' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.body).toMatch(/^<!DOCTYPE html><html lang="pt-BR">/)
    expect(res.body).toContain('PETR4')
    expect(res.body).toContain('VALE3')
    expect(res.body).toContain('badge bg-warning')
    await app.close()
  })

  it('renderiza fragmento HTMX sem doctype', async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/partial' })

    expect(res.body).not.toContain('<!DOCTYPE')
    expect(res.body).toMatch(/^<span class="badge bg-success">/)
    await app.close()
  })

  it('escapa interpolação por padrão', async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/partial' })

    expect(res.body).not.toContain('<script>alert(1)</script>')
    expect(res.body).toContain('&lt;script>alert(1)&lt;/script>')
    await app.close()
  })
})
