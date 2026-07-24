/**
 * Wrapper mínimo sobre o `fetch` nativo.
 * Substitui o RestClient + interceptor de log de HttpClientConfig.kt.
 *
 * Não lança em resposta de erro: devolve null e registra. Os clientes desta camada
 * degradam para "sem dado" em vez de derrubar a requisição do usuário — mesmo
 * comportamento dos try/catch do QuoteService original.
 */

const DEFAULT_TIMEOUT_MS = 15_000

/** O Yahoo bloqueia requisição sem User-Agent de navegador. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

export type Logger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} }

export type HttpOptions = {
  readonly timeoutMs?: number
  readonly userAgent?: string
  readonly logger?: Logger
}

export class HttpClient {
  private readonly timeoutMs: number
  private readonly userAgent: string | undefined
  private readonly logger: Logger

  constructor(options: HttpOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.userAgent = options.userAgent
    this.logger = options.logger ?? silentLogger
  }

  /** JSON da resposta, ou null em erro de rede, status ruim ou corpo inválido. */
  async getJson(url: string): Promise<unknown | null> {
    const text = await this.getText(url)
    if (text === null) return null
    try {
      return JSON.parse(text)
    } catch (error) {
      this.logger.warn(`Resposta não é JSON válido em ${url}: ${describe(error)}`)
      return null
    }
  }

  /** Corpo como texto, ou null em erro de rede ou status ruim. */
  async getText(url: string): Promise<string | null> {
    const started = Date.now()
    try {
      const response = await fetch(url, {
        headers: this.userAgent === undefined ? {} : { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      this.logger.info(`GET ${url} ${response.status} (${Date.now() - started}ms)`)

      if (!response.ok) {
        this.logger.warn(`GET ${url} devolveu ${response.status}`)
        return null
      }
      return await response.text()
    } catch (error) {
      this.logger.warn(`GET ${url} falhou: ${describe(error)}`)
      return null
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
