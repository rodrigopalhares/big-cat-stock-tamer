import cookie from '@fastify/cookie'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { AuthService } from '../modules/auth/auth.service.js'

/**
 * Exige sessão válida em toda requisição, menos login/logout e estáticos.
 * Porte de src/main/kotlin/com/stocks/config/AuthFilter.kt.
 *
 * Requisição não autenticada é redirecionada para o login — ou, se vier do HTMX,
 * responde 401 com HX-Redirect, porque o HTMX ignora redirect HTTP comum.
 */

export const SESSION_COOKIE = 'STOCKS_SESSION'

const PUBLIC_PREFIXES = ['/login', '/logout', '/css/', '/js/', '/favicon.ico', '/logo.png']

const plugin: FastifyPluginAsync<{ auth: AuthService }> = async (app, { auth }) => {
  await app.register(cookie)

  app.addHook('onRequest', async (request, reply) => {
    if (!auth.authEnabled) return
    if (
      PUBLIC_PREFIXES.some((prefix) => request.url === prefix || request.url.startsWith(prefix))
    ) {
      return
    }

    if (auth.isValid(request.cookies[SESSION_COOKIE])) return

    if (request.headers['hx-request'] !== undefined) {
      return reply.code(401).header('HX-Redirect', '/login').send()
    }
    return reply.redirect('/login', 302)
  })
}

export const authPlugin = fp(plugin, { name: 'auth' })

/** Cookie de sessão. `maxAge` zero apaga o cookie no logout. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    maxAge: maxAgeSeconds,
  }
}
