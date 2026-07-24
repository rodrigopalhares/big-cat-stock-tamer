/**
 * Cache em memória com expiração por tempo.
 *
 * Substitui os quatro campos `@Volatile` do QuoteService (cache de cotação e os dois
 * do CSV do Tesouro). O relógio entra por parâmetro para o teste não depender de espera real.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; storedAt: number }>()

  constructor(
    private readonly ttlSeconds: number,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  get(key: string): T | null {
    const entry = this.entries.get(key)
    if (entry === undefined) return null
    if (this.now() - entry.storedAt >= this.ttlSeconds) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, storedAt: this.now() })
  }

  clear(): void {
    this.entries.clear()
  }
}
