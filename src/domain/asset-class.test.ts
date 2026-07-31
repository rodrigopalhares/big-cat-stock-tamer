import { describe, expect, it } from 'vitest'
import { DEFAULT_ASSET_CLASSES, defaultClassNameForType } from './asset-class.js'
import { ASSET_TYPES } from './constants.js'

describe('defaultClassNameForType', () => {
  it.each([
    ['STOCK', 'Ações'],
    ['RENDA_FIXA', 'Renda Fixa'],
    ['TESOURO_DIRETO', 'Renda Fixa'],
    ['ETF', 'Internacional'],
    ['BDR', 'Internacional'],
    ['INTERNATIONAL', 'Internacional'],
    ['CRYPTO', 'Crypto'],
    ['REIT', 'Fii'],
  ])('%s → %s', (type, expected) => {
    expect(defaultClassNameForType(type)).toBe(expected)
  })

  it('OUTROS não recebe palpite — vai para o balde "Sem classe"', () => {
    expect(defaultClassNameForType('OUTROS')).toBeNull()
  })

  it('tipo desconhecido, null e undefined não quebram', () => {
    expect(defaultClassNameForType('NAO_EXISTE')).toBeNull()
    expect(defaultClassNameForType(null)).toBeNull()
    expect(defaultClassNameForType(undefined)).toBeNull()
  })

  it('todo tipo mapeado aponta para uma classe que a migration cria', () => {
    const created = new Set<string>(DEFAULT_ASSET_CLASSES.map((c) => c.name))

    for (const type of ASSET_TYPES) {
      const name = defaultClassNameForType(type)
      if (name !== null) expect(created).toContain(name)
    }
  })

  it('as metas iniciais somam 100%', () => {
    const total = DEFAULT_ASSET_CLASSES.reduce((sum, c) => sum + c.targetPercent, 0)
    expect(total).toBe(100)
  })
})
