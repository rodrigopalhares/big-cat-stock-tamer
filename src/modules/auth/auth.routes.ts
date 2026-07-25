import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { SESSION_COOKIE, sessionCookieOptions } from '../../plugins/auth.js'
import { LoginPage } from '../../views/pages/login.js'

/** Porte de src/main/kotlin/com/stocks/controller/AuthController.kt. */

const LoginForm = z.object({ password: z.string().default('') })

export function authRoutes(c: Container, sessionDays: number): FastifyPluginAsync {
  return async (app) => {
    app.get('/login', async (_req, reply) => {
      // Sem autenticação configurada não há o que fazer na tela de login.
      if (!c.auth.authEnabled) return reply.redirect('/portfolio/', 302)
      return reply.html(LoginPage({}))
    })

    app.post('/login', async (req, reply) => {
      const { password } = LoginForm.parse(req.body)
      const token = c.auth.login(password)

      if (token === null) {
        // Mesma página com o aviso — sem redirect, para não expor o erro na URL.
        return reply.code(401).html(LoginPage({ error: true }))
      }

      return reply
        .setCookie(SESSION_COOKIE, token, sessionCookieOptions(sessionDays * 86_400))
        .redirect('/portfolio/', 302)
    })

    app.post('/logout', async (req, reply) => {
      c.auth.logout(req.cookies[SESSION_COOKIE])
      return reply.setCookie(SESSION_COOKIE, '', sessionCookieOptions(0)).redirect('/login', 302)
    })
  }
}
