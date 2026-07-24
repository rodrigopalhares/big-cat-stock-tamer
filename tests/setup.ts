import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './msw.js'

process.env['NODE_ENV'] = 'test'
process.env['DATABASE_URL'] ??= 'file::memory:'
process.env['LOG_LEVEL'] ??= 'silent'

// `error` garante que uma chamada HTTP não prevista quebre o teste em vez de
// vazar para a rede de verdade.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
