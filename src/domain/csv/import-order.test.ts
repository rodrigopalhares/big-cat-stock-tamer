import { describe, expect, it } from 'vitest'
import { type ImportOrderKey, sortByImportOrder } from './import-order.js'

const key = (row: ImportOrderKey): ImportOrderKey => row

describe('sortByImportOrder', () => {
  it('põe erro na frente, depois desconhecido, novo e existente', () => {
    const rows: ImportOrderKey[] = [
      { status: 'EXISTS', type: 'STOCK', name: 'A' },
      { status: 'WILL_CREATE', type: 'STOCK', name: 'A' },
      { status: 'ERROR', type: 'STOCK', name: 'A' },
      { status: 'UNKNOWN', type: 'STOCK', name: 'A' },
    ]

    expect(sortByImportOrder(rows, key).map((row) => row.status)).toEqual([
      'ERROR',
      'UNKNOWN',
      'WILL_CREATE',
      'EXISTS',
    ])
  })

  it('desempata pelo tipo dentro do mesmo status', () => {
    const rows: ImportOrderKey[] = [
      { status: 'EXISTS', type: 'STOCK', name: 'A' },
      { status: 'EXISTS', type: 'ETF', name: 'Z' },
      { status: 'EXISTS', type: 'REIT', name: 'A' },
    ]

    expect(sortByImportOrder(rows, key).map((row) => row.type)).toEqual(['ETF', 'REIT', 'STOCK'])
  })

  it('desempata pelo nome dentro do mesmo tipo', () => {
    const rows: ImportOrderKey[] = [
      { status: 'EXISTS', type: 'STOCK', name: 'Vale' },
      { status: 'EXISTS', type: 'STOCK', name: 'Ambev' },
      { status: 'EXISTS', type: 'STOCK', name: 'Petrobras' },
    ]

    expect(sortByImportOrder(rows, key).map((row) => row.name)).toEqual([
      'Ambev',
      'Petrobras',
      'Vale',
    ])
  })

  it('nome com acento ordena como em português', () => {
    const rows: ImportOrderKey[] = [
      { status: 'EXISTS', type: 'STOCK', name: 'Azul' },
      { status: 'EXISTS', type: 'STOCK', name: 'Água' },
    ]

    expect(sortByImportOrder(rows, key).map((row) => row.name)).toEqual(['Água', 'Azul'])
  })

  it('linha empatada mantém a ordem do CSV', () => {
    const rows = [
      { id: 1, status: 'EXISTS' as const, type: 'STOCK', name: 'Petrobras' },
      { id: 2, status: 'EXISTS' as const, type: 'STOCK', name: 'Petrobras' },
      { id: 3, status: 'ERROR' as const, type: 'STOCK', name: 'Petrobras' },
    ]

    expect(sortByImportOrder(rows, key).map((row) => row.id)).toEqual([3, 1, 2])
  })
})
