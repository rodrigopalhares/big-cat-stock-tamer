import { describe, expect, it } from 'vitest'
import { isoDate } from '../shared/iso-date.js'
import { dailyName, excess, monthlyName } from './backup-retention.js'

// Porte de src/test/kotlin/com/stocks/service/BackupRetentionTest.kt

describe('nomes', () => {
  it('nome diário carrega a data completa', () => {
    expect(dailyName(isoDate('2026-06-09'))).toBe('stocks-2026-06-09.zip')
  })

  it('nome mensal carrega só ano e mês, com zero à esquerda', () => {
    expect(monthlyName(isoDate('2026-06-09'))).toBe('stocks-2026-06.zip')
  })
})

describe('excedente', () => {
  it('sem nomes, nada a remover', () => {
    expect(excess([], 7)).toEqual([])
  })

  it('abaixo do limite, nada é removido', () => {
    const names = ['stocks-2026-06-07.zip', 'stocks-2026-06-08.zip']
    expect(excess(names, 7)).toEqual([])
  })

  it('remove os mais antigos, mantendo os mais recentes', () => {
    const names = Array.from(
      { length: 9 },
      (_, i) => `stocks-2026-06-${String(i + 1).padStart(2, '0')}.zip`,
    )
    // Mantém os 7 mais recentes (03..09); remove os 2 mais antigos.
    expect(excess(names, 7)).toEqual(['stocks-2026-06-01.zip', 'stocks-2026-06-02.zip'])
  })

  it('resultado não depende da ordem de entrada', () => {
    const names = ['stocks-2026-06-09.zip', 'stocks-2026-06-01.zip', 'stocks-2026-06-05.zip']
    expect(excess(names, 2)).toEqual(['stocks-2026-06-01.zip'])
  })

  it('retenção mensal mantém os últimos 3 meses', () => {
    const names = [
      'stocks-2026-04.zip',
      'stocks-2026-05.zip',
      'stocks-2026-06.zip',
      'stocks-2026-07.zip',
    ]
    expect(excess(names, 3)).toEqual(['stocks-2026-04.zip'])
  })

  it('manter zero remove tudo', () => {
    const names = ['stocks-2026-06-08.zip', 'stocks-2026-06-09.zip']
    expect(excess(names, 0)).toEqual([...names].sort())
  })

  it('não altera o array recebido', () => {
    const names = ['stocks-2026-06-09.zip', 'stocks-2026-06-01.zip']
    excess(names, 1)
    expect(names).toEqual(['stocks-2026-06-09.zip', 'stocks-2026-06-01.zip'])
  })
})
