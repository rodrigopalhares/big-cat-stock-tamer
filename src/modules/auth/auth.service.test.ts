import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthService } from './auth.service.js'

// Porte de src/test/kotlin/com/stocks/service/AuthServiceTest.kt

describe('AuthService', () => {
  let dir: string
  let keyFile: string
  let clock: number

  const service = (password = 'segredo', sessionDays = 365) =>
    new AuthService({ password, keyFile, sessionDays, now: () => clock })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auth-test-'))
    keyFile = join(dir, 'auth.key')
    clock = 1_700_000_000
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('login com a senha certa devolve um token', () => {
    const token = service().login('segredo')
    expect(token).not.toBeNull()
    expect((token as string).length).toBeGreaterThan(20)
  })

  it('login com senha errada devolve null', () => {
    expect(service().login('errada')).toBeNull()
  })

  it('login com senha de tamanho diferente devolve null', () => {
    expect(service().login('x')).toBeNull()
  })

  it('token válido é aceito', () => {
    const auth = service()
    const token = auth.login('segredo') as string
    expect(auth.isValid(token)).toBe(true)
  })

  it.each([null, undefined, '', '   ', 'token-inventado'])(
    'token inválido é rejeitado: %s',
    (token) => {
      const auth = service()
      auth.login('segredo')
      expect(auth.isValid(token)).toBe(false)
    },
  )

  it('sessão sobrevive ao restart do serviço', () => {
    const token = service().login('segredo') as string

    // Instância nova, mesmo arquivo — é o que acontece ao reiniciar.
    expect(service().isValid(token)).toBe(true)
  })

  it('logout invalida o token', () => {
    const auth = service()
    const token = auth.login('segredo') as string

    auth.logout(token)

    expect(auth.isValid(token)).toBe(false)
  })

  it('logout de token desconhecido não derruba as outras sessões', () => {
    const auth = service()
    const token = auth.login('segredo') as string

    auth.logout('outro-token')

    expect(auth.isValid(token)).toBe(true)
  })

  it('sessão expirada é rejeitada', () => {
    const auth = service('segredo', 1)
    const token = auth.login('segredo') as string

    clock += 86_400 + 1

    expect(auth.isValid(token)).toBe(false)
  })

  it('sessão dentro do prazo continua válida', () => {
    const auth = service('segredo', 1)
    const token = auth.login('segredo') as string

    clock += 86_400 - 10

    expect(auth.isValid(token)).toBe(true)
  })

  it('senha vazia desabilita a autenticação e libera tudo', () => {
    const auth = service('')

    expect(auth.authEnabled).toBe(false)
    expect(auth.isValid(null)).toBe(true)
    expect(auth.login('qualquer')).toBeNull()
  })

  it('várias sessões podem valer ao mesmo tempo', () => {
    const auth = service()
    const first = auth.login('segredo') as string
    const second = auth.login('segredo') as string

    expect(first).not.toBe(second)
    expect(auth.isValid(first)).toBe(true)
    expect(auth.isValid(second)).toBe(true)
  })

  it('o arquivo guarda o hash, nunca o token em claro', () => {
    const auth = service()
    const token = auth.login('segredo') as string

    const contents = readFileSync(keyFile, 'utf8')
    expect(contents).not.toContain(token)
    expect(contents).toMatch(/^[a-f0-9]{64}:\d+$/)
  })
})
