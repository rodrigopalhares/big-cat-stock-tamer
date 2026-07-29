import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './msw.js'

// O ambiente do desenvolvedor (direnv/.env) não pode vazar para os testes: senha de
// autenticação ou diretório de dados reais fariam a suíte testar outra configuração
// — ou pior, escrever no diretório de produção.
for (const key of [
  'APP_AUTH_PASSWORD',
  'APP_AUTH_KEY_FILE',
  'APP_DATA_DIR',
  'APP_BACKUP_DIR',
  'APP_BACKUP_ENABLED',
  // Com a chave do ambiente carregada, um teste distraído chamaria a Anthropic de verdade.
  'APP_ANTHROPIC_API_KEY',
  'APP_NOTES_DIR',
]) {
  delete process.env[key]
}

process.env['NODE_ENV'] = 'test'
process.env['DATABASE_URL'] ??= 'file::memory:'
process.env['LOG_LEVEL'] ??= 'silent'

// `error` garante que uma chamada HTTP não prevista quebre o teste em vez de
// vazar para a rede de verdade.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
