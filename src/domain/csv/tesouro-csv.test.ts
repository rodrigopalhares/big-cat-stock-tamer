import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { latestRows, parseTesouroCsv, rowsForTicker, splitTesouroTicker } from './tesouro-csv.js'

const sample = readFileSync(
  join(import.meta.dirname, '../../../tests/fixtures/tesouro_direto_sample.csv'),
  'utf8',
)

describe('parseTesouroCsv', () => {
  it('lê o fixture completo', () => {
    const rows = parseTesouroCsv(sample)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toEqual({
      tipoTitulo: 'Tesouro Selic',
      dataVencimento: '01/03/2029',
      dataBase: '2024-03-01',
      puCompraManha: 14205.32,
    })
  })

  it('converte decimal com vírgula', () => {
    const rows = parseTesouroCsv(sample)
    expect(rows[0]?.puCompraManha).toBeCloseTo(14205.32, 2)
  })

  it('texto vazio devolve lista vazia', () => {
    expect(parseTesouroCsv('')).toEqual([])
  })

  it('só cabeçalho devolve lista vazia', () => {
    expect(parseTesouroCsv('Tipo Titulo;Data Vencimento;Data Base;PU Compra Manha')).toEqual([])
  })

  it('cabeçalho é lido sem depender de maiúsculas ou espaços', () => {
    const csv =
      '  TIPO TITULO ;Data Vencimento;  data base  ;PU Compra Manha\nX;01/01/2030;05/06/2024;10,5'
    expect(parseTesouroCsv(csv)[0]).toEqual({
      tipoTitulo: 'X',
      dataVencimento: '01/01/2030',
      dataBase: '2024-06-05',
      puCompraManha: 10.5,
    })
  })

  it('data inválida vira null sem descartar a linha', () => {
    const csv = 'Tipo Titulo;Data Vencimento;Data Base;PU Compra Manha\nX;01/01/2030;lixo;10,5'
    expect(parseTesouroCsv(csv)[0]?.dataBase).toBeNull()
    expect(parseTesouroCsv(csv)[0]?.puCompraManha).toBe(10.5)
  })

  it('PU vazio ou inválido vira null', () => {
    const csv =
      'Tipo Titulo;Data Vencimento;Data Base;PU Compra Manha\nX;01/01/2030;05/06/2024;\nY;01/01/2030;05/06/2024;abc'
    const rows = parseTesouroCsv(csv)
    expect(rows[0]?.puCompraManha).toBeNull()
    expect(rows[1]?.puCompraManha).toBeNull()
  })
})

describe('splitTesouroTicker', () => {
  it('separa título e vencimento', () => {
    expect(splitTesouroTicker('Tesouro Selic;01/03/2029')).toEqual({
      title: 'Tesouro Selic',
      maturity: '01/03/2029',
    })
  })

  it('sem ponto e vírgula devolve null', () => {
    expect(splitTesouroTicker('PETR4')).toBeNull()
  })

  it('só divide no primeiro ponto e vírgula', () => {
    expect(splitTesouroTicker('A;B;C')).toEqual({ title: 'A', maturity: 'B;C' })
  })
})

describe('rowsForTicker e latestRows', () => {
  const rows = parseTesouroCsv(sample)

  it('filtra por título e vencimento', () => {
    const matched = rowsForTicker(rows, 'Tesouro Selic;01/03/2029')
    expect(matched).toHaveLength(3)
    expect(matched.every((r) => r.tipoTitulo === 'Tesouro Selic')).toBe(true)
  })

  it('ticker inválido devolve vazio', () => {
    expect(rowsForTicker(rows, 'PETR4')).toEqual([])
  })

  it('latestRows mantém só a data-base mais recente', () => {
    const latest = latestRows(rows)
    expect(latest.every((r) => r.dataBase === '2024-03-03')).toBe(true)
  })

  it('latestRows de lista vazia devolve vazio', () => {
    expect(latestRows([])).toEqual([])
  })
})
