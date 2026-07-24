import { describe, expect, it } from 'vitest'
import { TtlCache } from './ttl-cache.js'

describe('TtlCache', () => {
  const withClock = <T>(ttl: number) => {
    let clock = 1_000
    const cache = new TtlCache<T>(ttl, () => clock)
    return { cache, advance: (seconds: number) => (clock += seconds) }
  }

  it('devolve null para chave ausente', () => {
    const { cache } = withClock<number>(60)
    expect(cache.get('x')).toBeNull()
  })

  it('devolve o valor dentro do TTL', () => {
    const { cache, advance } = withClock<number>(60)
    cache.set('x', 42)
    advance(59)
    expect(cache.get('x')).toBe(42)
  })

  it('expira exatamente no TTL', () => {
    const { cache, advance } = withClock<number>(60)
    cache.set('x', 42)
    advance(60)
    expect(cache.get('x')).toBeNull()
  })

  it('renova o carimbo ao regravar', () => {
    const { cache, advance } = withClock<number>(60)
    cache.set('x', 1)
    advance(59)
    cache.set('x', 2)
    advance(59)
    expect(cache.get('x')).toBe(2)
  })

  it('chaves são independentes', () => {
    const { cache, advance } = withClock<number>(60)
    cache.set('a', 1)
    advance(30)
    cache.set('b', 2)
    advance(31)
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe(2)
  })

  it('clear esvazia tudo', () => {
    const { cache } = withClock<number>(60)
    cache.set('x', 1)
    cache.clear()
    expect(cache.get('x')).toBeNull()
  })
})
