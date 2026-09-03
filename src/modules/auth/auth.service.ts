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
 *
 * Tentativas erradas são contadas por cliente. Com um segredo só protegendo tudo e a
 * aplicação escutando em 0.0.0.0, comparar em tempo constante não basta: isso defende de
 * ataque por temporização, não de volume. Sem o contador, qualquer host da rede podia tentar
 * senhas na velocidade que o servidor aguentasse.
 */

export type AuthOptions = {
  password: string
  keyFile: string
  sessionDays: number
  logger?: Logger
  /** Injetável para o teste controlar a expiração sem esperar. */
  now?: () => number
}

/**
 * O resultado tem três estados de propósito. Com `string | null` a rota não teria como
 * distinguir senha errada de cliente bloqueado — e nada a obrigaria a checar o bloqueio.
 */
export type LoginResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: 'invalid' }
  | { readonly ok: false; readonly reason: 'blocked'; readonly retryAfterSeconds: number }

type Session = {
  tokenHash: string
  expiresAtEpoch: number
}

type Attempts = {
  failures: number
  /** Início da janela em que as falhas são somadas. */
  windowStartedAt: number
  blockedUntilEpoch: number
  /** Quantos bloqueios este cliente já levou — é o que faz o próximo durar mais. */
  level: number
}

/** Cinco erros seguidos numa janela de um minuto. */
const MAX_FAILURES = 5
const WINDOW_SECONDS = 60

/** O bloqueio cresce a cada rodada: um minuto, cinco, quinze. */
const BLOCK_SECONDS = [60, 300, 900] as const

/**
 * Por quanto tempo se lembra de que um cliente já foi bloqueado.
 *
 * Sem esta memória o escalonamento não existiria: bastaria esperar o bloqueio de um minuto
 * acabar para o registro ser descartado e o próximo bloqueio recomeçar do primeiro degrau,
 * dando cinco tentativas novas por minuto, indefinidamente.
 */
const LEVEL_MEMORY_SECONDS = 3600

export class AuthService {
  private readonly password: string
  private readonly keyFile: string
  private readonly sessionDays: number
  private readonly logger: Logger
  private readonly now: () => number

  /**
   * Em memória de propósito: reiniciar a aplicação zera os contadores, e tudo bem — quem
   * reinicia é o dono da máquina, não quem está tentando adivinhar a senha de fora.
   */
  private readonly attempts = new Map<string, Attempts>()

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
   *
   * `clientId` é o IP de quem pediu. Cliente bloqueado nem chega a ter a senha conferida:
   * acertar durante o bloqueio não o encurta, senão bastaria continuar tentando.
   */
  login(rawPassword: string, clientId = 'desconhecido'): LoginResult {
    if (!this.authEnabled) return { ok: false, reason: 'invalid' }

    this.pruneAttempts()

    const blocked = this.attempts.get(clientId)?.blockedUntilEpoch ?? 0
    if (blocked > this.now()) {
      return { ok: false, reason: 'blocked', retryAfterSeconds: blocked - this.now() }
    }

    if (!constantTimeEquals(rawPassword, this.password)) {
      this.registerFailure(clientId)
      return { ok: false, reason: 'invalid' }
    }

    this.attempts.delete(clientId)

    const token = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + this.sessionDays * 86_400

    const sessions = this.readSessions().filter((s) => !this.isExpired(s))
    this.writeSessions([...sessions, { tokenHash: hash(token), expiresAtEpoch: expiresAt }])

    return { ok: true, token }
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

  /**
   * Conta a falha e, no limite, arma o bloqueio.
   *
   * A janela recomeça quando expira, então erro esparso ao longo do dia não acumula até
   * bloquear — só a rajada bloqueia. O `level`, esse não zera com a janela: quem já foi
   * bloqueado uma vez pega um bloqueio mais longo na próxima.
   */
  private registerFailure(clientId: string): void {
    const now = this.now()
    const current = this.attempts.get(clientId)
    const inWindow = current !== undefined && now - current.windowStartedAt < WINDOW_SECONDS

    const entry: Attempts = inWindow
      ? { ...current, failures: current.failures + 1 }
      : { failures: 1, windowStartedAt: now, blockedUntilEpoch: 0, level: current?.level ?? 0 }

    if (entry.failures >= MAX_FAILURES) {
      const seconds = BLOCK_SECONDS[Math.min(entry.level, BLOCK_SECONDS.length - 1)] ?? 60
      entry.blockedUntilEpoch = now + seconds
      entry.level += 1
      entry.failures = 0
      entry.windowStartedAt = now
      this.logger.warn(
        `Login bloqueado para ${clientId} por ${seconds}s após ${MAX_FAILURES} tentativas erradas.`,
      )
    }

    this.attempts.set(clientId, entry)
  }

  /** Descarta quem não está bloqueado nem tem falha recente, para o mapa não crescer. */
  private pruneAttempts(): void {
    const now = this.now()
    for (const [clientId, entry] of this.attempts) {
      const blockOver = entry.blockedUntilEpoch <= now
      const windowOver = now - entry.windowStartedAt >= WINDOW_SECONDS
      // Quem já foi bloqueado fica no mapa por mais uma hora, mesmo sem falha recente — é o
      // que preserva o `level` e faz o próximo bloqueio durar mais.
      const forgotten = entry.level === 0 || now - entry.blockedUntilEpoch >= LEVEL_MEMORY_SECONDS

      if (blockOver && windowOver && forgotten) this.attempts.delete(clientId)
    }
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
