import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Logger } from '../../integrations/http.js'
import { silentLogger } from '../../integrations/http.js'

/**
 * Autenticação simples de usuário único.
 * Porte de src/main/kotlin/com/stocks/service/AuthService.kt.
 *
 * A senha vem do ambiente. O login gera um token aleatório cujo *hash* é gravado num arquivo
 * local — a sessão sobrevive a restart sem precisar de banco, e o arquivo nunca guarda o
 * token em claro, então vazá-lo não dá acesso a ninguém.
 */

export type AuthOptions = {
  password: string
  keyFile: string
  sessionDays: number
  logger?: Logger
  /** Injetável para o teste controlar a expiração sem esperar. */
  now?: () => number
}

type Session = {
  tokenHash: string
  expiresAtEpoch: number
}

export class AuthService {
  private readonly password: string
  private readonly keyFile: string
  private readonly sessionDays: number
  private readonly logger: Logger
  private readonly now: () => number

  /** Sem senha configurada a autenticação fica desligada e tudo passa. */
  readonly authEnabled: boolean

  constructor(options: AuthOptions) {
    this.password = options.password
    this.keyFile = options.keyFile
    this.sessionDays = options.sessionDays
    this.logger = options.logger ?? silentLogger
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
    this.authEnabled = options.password.length > 0

    if (!this.authEnabled) {
      this.logger.warn(
        'APP_AUTH_PASSWORD não está definida — autenticação DESABILITADA. Defina no .env para proteger a aplicação.',
      )
    }
  }

  /**
   * Valida a senha e, dando certo, cria a sessão.
   * Devolve o token em claro para o cookie, ou null se a senha estiver errada.
   */
  login(rawPassword: string): string | null {
    if (!this.authEnabled) return null
    if (!constantTimeEquals(rawPassword, this.password)) return null

    const token = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + this.sessionDays * 86_400

    const sessions = this.readSessions().filter((s) => !this.isExpired(s))
    this.writeSessions([...sessions, { tokenHash: hash(token), expiresAtEpoch: expiresAt }])

    return token
  }

  /** True quando o token corresponde a uma sessão gravada e ainda válida. */
  isValid(token: string | null | undefined): boolean {
    if (!this.authEnabled) return true
    if (token === null || token === undefined || token.trim() === '') return false

    const hashed = hash(token)
    const sessions = this.readSessions()
    const valid = sessions.filter((s) => !this.isExpired(s))

    // Aproveita a leitura para descartar as expiradas.
    if (valid.length !== sessions.length) this.writeSessions(valid)

    return valid.some((s) => constantTimeEquals(s.tokenHash, hashed))
  }

  /** Remove a sessão do token, se houver. */
  logout(token: string | null | undefined): void {
    if (token === null || token === undefined || token.trim() === '') return
    const hashed = hash(token)
    this.writeSessions(
      this.readSessions().filter((s) => !this.isExpired(s) && s.tokenHash !== hashed),
    )
  }

  private isExpired(session: Session): boolean {
    return session.expiresAtEpoch < this.now()
  }

  private readSessions(): Session[] {
    if (!existsSync(this.keyFile)) return []
    return readFileSync(this.keyFile, 'utf8')
      .split('\n')
      .map((line) => line.trim().split(':'))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([tokenHash, expires]) => ({ tokenHash, expiresAtEpoch: Number(expires) }))
      .filter((s) => Number.isFinite(s.expiresAtEpoch))
  }

  private writeSessions(sessions: readonly Session[]): void {
    mkdirSync(dirname(this.keyFile), { recursive: true })
    writeFileSync(
      this.keyFile,
      sessions.map((s) => `${s.tokenHash}:${s.expiresAtEpoch}`).join('\n'),
    )
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Comparação em tempo constante — não vaza o tamanho do prefixo correto pelo tempo de resposta. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}
