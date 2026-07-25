import { describe, expect, it, vi } from 'vitest'
import { startScheduler } from './scheduler.js'

/**
 * O SchedulerConfig do Kotlin não tinha teste — o TestSchedulerConfig existia justamente
 * para *impedir* os jobs de rodar durante os testes. Aqui o comportamento que importa é
 * testável: o backup roda no boot, e um job que falha não derruba nada.
 */
describe('scheduler', () => {
  const deps = (overrides: Record<string, unknown> = {}) => ({
    priceHistory: { runDailyUpdate: vi.fn(async () => {}) },
    exchangeRates: { getRate: vi.fn(async () => 5) },
    backup: { ensureBackups: vi.fn(async () => {}) },
    ...overrides,
  })

  it('faz backup ao iniciar', async () => {
    const d = deps()
    const scheduler = startScheduler(d as never)

    // O backup de boot é disparado sem await; espera o microtask.
    await new Promise((resolve) => setImmediate(resolve))

    expect(d.backup.ensureBackups).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('backup que falha no boot não propaga', async () => {
    const d = deps({
      backup: {
        ensureBackups: vi.fn(async () => {
          throw new Error('disco cheio')
        }),
      },
    })

    const scheduler = startScheduler(d as never)
    await new Promise((resolve) => setImmediate(resolve))

    scheduler.stop()
  })

  it('registra o erro no logger em vez de lançar', async () => {
    const errors: string[] = []
    const d = deps({
      backup: {
        ensureBackups: vi.fn(async () => {
          throw new Error('disco cheio')
        }),
      },
    })

    const scheduler = startScheduler({
      ...d,
      logger: { info: () => {}, warn: () => {}, error: (m: string) => errors.push(m) },
    } as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(errors.some((e) => e.includes('disco cheio'))).toBe(true)
    scheduler.stop()
  })

  it('stop encerra os jobs sem lançar', () => {
    const scheduler = startScheduler(deps() as never)
    expect(() => scheduler.stop()).not.toThrow()
  })

  it('não roda a atualização de preços no boot', async () => {
    const d = deps()
    const scheduler = startScheduler(d as never)
    await new Promise((resolve) => setImmediate(resolve))

    // Só o backup roda na inicialização; cotação espera o horário do pregão.
    expect(d.priceHistory.runDailyUpdate).not.toHaveBeenCalled()
    scheduler.stop()
  })
})
