import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthService, type LoginResult } from './auth.service.js'

// Porte de src/test/kotlin/com/stocks/service/AuthServiceTest.kt

describe('AuthService', () => {
  let dir: string
  let keyFile: string
  let clock: number

  const service = (password = 'segredo', sessionDays = 365) =>
    new AuthService({ password, keyFile, sessionDays, now: () => clock })

  /** O token de um login que deu certo — falha o teste, em vez de devolver undefined. */
  const tokenOf = (result: LoginResult): string => {
    if (!result.ok) throw new Error(`login não deveria ter falhado: ${result.reason}`)
    return result.token
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auth-test-'))
    keyFile = join(dir, 'auth.key')
    clock = 1_700_000_000
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('login com a senha certa devolve um token', () => {
    const token = tokenOf(service().login('segredo'))
    expect(token.length).toBeGreaterThan(20)
  })

  it('login com senha errada devolve null', () => {
    expect(service().login('errada')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('login com senha de tamanho diferente devolve null', () => {
    expect(service().login('x')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('token válido é aceito', () => {
    const auth = service()
    const token = tokenOf(auth.login('segredo'))
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
    const token = tokenOf(service().login('segredo'))

    // Instância nova, mesmo arquivo — é o que acontece ao reiniciar.
    expect(service().isValid(token)).toBe(true)
  })

  it('logout invalida o token', () => {
    const auth = service()
    const token = tokenOf(auth.login('segredo'))

    auth.logout(token)

    expect(auth.isValid(token)).toBe(false)
  })

  it('logout de token desconhecido não derruba as outras sessões', () => {
    const auth = service()
    const token = tokenOf(auth.login('segredo'))

    auth.logout('outro-token')

    expect(auth.isValid(token)).toBe(true)
  })

  it('sessão expirada é rejeitada', () => {
    const auth = service('segredo', 1)
    const token = tokenOf(auth.login('segredo'))

    clock += 86_400 + 1

    expect(auth.isValid(token)).toBe(false)
  })

  it('sessão dentro do prazo continua válida', () => {
    const auth = service('segredo', 1)
    const token = tokenOf(auth.login('segredo'))

    clock += 86_400 - 10

    expect(auth.isValid(token)).toBe(true)
  })

  it('senha vazia desabilita a autenticação e libera tudo', () => {
    const auth = service('')

    expect(auth.authEnabled).toBe(false)
    expect(auth.isValid(null)).toBe(true)
    expect(auth.login('qualquer')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('várias sessões podem valer ao mesmo tempo', () => {
    const auth = service()
    const first = tokenOf(auth.login('segredo'))
    const second = tokenOf(auth.login('segredo'))

    expect(first).not.toBe(second)
    expect(auth.isValid(first)).toBe(true)
    expect(auth.isValid(second)).toBe(true)
  })

  /**
   * Com um segredo só protegendo tudo e a aplicação escutando em 0.0.0.0, ausência de limite
   * de tentativas é a diferença entre um segredo e um segredo enumerável na rede local.
   */
  describe('limite de tentativas', () => {
    const failTimes = (auth: AuthService, times: number, clientId = '10.0.0.1') => {
      for (let i = 0; i < times; i++) auth.login('errada', clientId)
    }

    it('a sexta tentativa errada é bloqueada, não só recusada', () => {
      const auth = service()
      failTimes(auth, 5)

      expect(auth.login('errada', '10.0.0.1')).toEqual({
        ok: false,
        reason: 'blocked',
        retryAfterSeconds: 60,
      })
    })

    it('a quinta ainda é recusada como senha errada — é ela que arma o bloqueio', () => {
      const auth = service()
      failTimes(auth, 4)

      expect(auth.login('errada', '10.0.0.1')).toEqual({ ok: false, reason: 'invalid' })
    })

    it('a senha certa durante o bloqueio continua bloqueada', () => {
      const auth = service()
      failTimes(auth, 5)

      expect(auth.login('segredo', '10.0.0.1')).toMatchObject({ reason: 'blocked' })
    })

    it('o bloqueio solta quando o prazo passa', () => {
      const auth = service()
      failTimes(auth, 5)

      clock += 61
      expect(tokenOf(auth.login('segredo', '10.0.0.1')).length).toBeGreaterThan(20)
    })

    it('o segundo bloqueio dura mais que o primeiro', () => {
      const auth = service()
      failTimes(auth, 5)
      clock += 61
      failTimes(auth, 5)

      expect(auth.login('errada', '10.0.0.1')).toEqual({
        ok: false,
        reason: 'blocked',
        retryAfterSeconds: 300,
      })
    })

    it('clientes diferentes não se bloqueiam', () => {
      const auth = service()
      failTimes(auth, 5, '10.0.0.1')

      expect(auth.login('segredo', '10.0.0.2')).toMatchObject({ ok: true })
    })

    it('login certo zera o contador', () => {
      const auth = service()
      failTimes(auth, 4)
      auth.login('segredo', '10.0.0.1')

      failTimes(auth, 4)
      expect(auth.login('errada', '10.0.0.1')).toEqual({ ok: false, reason: 'invalid' })
    })

    it('erro esparso não acumula: a janela recomeça depois de um minuto', () => {
      const auth = service()
      for (let i = 0; i < 10; i++) {
        auth.login('errada', '10.0.0.1')
        clock += 61
      }

      expect(auth.login('errada', '10.0.0.1')).toEqual({ ok: false, reason: 'invalid' })
    })
  })

  it('o arquivo guarda o hash, nunca o token em claro', () => {
    const auth = service()
    const token = tokenOf(auth.login('segredo'))

    const contents = readFileSync(keyFile, 'utf8')
    expect(contents).not.toContain(token)
    expect(contents).toMatch(/^[a-f0-9]{64}:\d+$/)
  })
})
