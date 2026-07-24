import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { VNode } from 'preact'
import { render } from 'preact-render-to-string'

declare module 'fastify' {
  interface FastifyReply {
    /** Página completa, com doctype. */
    html(node: VNode): FastifyReply
    /** Fragmento HTMX, sem doctype — injetado numa página já renderizada. */
    partial(node: VNode): FastifyReply
  }
}

const HTML = 'text/html; charset=utf-8'

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateReply('html', function (node: VNode) {
    return this.type(HTML).send(`<!DOCTYPE html>${render(node)}`)
  })

  app.decorateReply('partial', function (node: VNode) {
    return this.type(HTML).send(render(node))
  })
}

export const viewsPlugin = fp(plugin, { name: 'views' })
