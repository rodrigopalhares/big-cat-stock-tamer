import { describe, expect, it } from 'vitest'
import { parseDividendCsvRows } from './dividend-csv.js'

// Porte da parte pura de src/test/kotlin/com/stocks/service/DividendCsvParsingServiceTest.kt.
// O teste de `batchImportDividends` toca o banco e entra na fase 4.

const registered = new Set(['PETR4', 'VALE3', 'MXRF11'])

describe('parseDividendCsvRows', () => {
  it('linhas válidas', () => {
    const csv =
      'PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP\t\tTeste\n' +
      'VALE3\t15/02/2026\tJCP\t2,30\t0,35\tBRL\tClear'

    const rows = parseDividendCsvRows(csv, registered)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      ticker: 'PETR4',
      date: '2026-03-01',
      type: 'DIVIDENDO',
      totalAmount: 1.5,
      taxWithheld: 0,
      currency: 'BRL',
      broker: 'XP',
      notes: 'Teste',
      error: null,
    })
    expect(rows[1]).toMatchObject({
      ticker: 'VALE3',
      date: '2026-02-15',
      type: 'JCP',
      totalAmount: 2.3,
      taxWithheld: 0.35,
      error: null,
    })
  })

  it('colunas insuficientes', () => {
    const rows = parseDividendCsvRows('PETR4\t01/03/2026\tDIVIDENDO', registered)
    expect(rows[0]?.error).toContain('Colunas insuficientes')
  })

  it('ticker vazio', () => {
    const rows = parseDividendCsvRows('\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP', registered)
    expect(rows[0]?.error).toContain('Ticker vazio')
  })

  it('data inválida', () => {
    const rows = parseDividendCsvRows(
      'PETR4\t99/99/9999\tDIVIDENDO\t1,50\t0,00\tBRL\tXP',
      registered,
    )
    expect(rows[0]?.error).toContain('Data inválida')
  })

  it('tipo desconhecido preserva os campos válidos', () => {
    const rows = parseDividendCsvRows(
      'PETR4\t01/03/2026\tUNKNOWN_TYPE\t1,50\t0,00\tBRL\tXP',
      registered,
    )
    expect(rows[0]?.error).toContain('Tipo desconhecido')
    expect(rows[0]?.date).toBe('2026-03-01')
    expect(rows[0]?.totalAmount).toBeCloseTo(1.5, 3)
    expect(rows[0]?.ticker).toBe('PETR4')
  })

  it('valor zero ou negativo', () => {
    const rows = parseDividendCsvRows(
      'PETR4\t01/03/2026\tDIVIDENDO\t0,00\t0,00\tBRL\tXP',
      registered,
    )
    expect(rows[0]?.error).toContain('Valor deve ser > 0')
  })

  it('IR retido negativo', () => {
    const rows = parseDividendCsvRows(
      'PETR4\t01/03/2026\tDIVIDENDO\t1,50\t-1,00\tBRL\tXP',
      registered,
    )
    expect(rows[0]?.error).toContain('IR Retido não pode ser negativo')
  })

  it('ativo não cadastrado preserva os campos válidos', () => {
    const rows = parseDividendCsvRows(
      'XXXX9\t01/03/2026\tDIVIDENDO\t1,00\t0,00\tBRL\tXP',
      registered,
    )
    expect(rows[0]?.error).toContain('Ativo não cadastrado')
    expect(rows[0]?.date).toBe('2026-03-01')
    expect(rows[0]?.type).toBe('DIVIDENDO')
    expect(rows[0]?.totalAmount).toBeCloseTo(1, 3)
  })

  it('vários erros acumulam na mesma linha', () => {
    const rows = parseDividendCsvRows('XXXX9\t99/99/9999\tUNKNOWN\tabc\t0,00\tBRL\tXP', registered)
    const row = rows[0]
    expect(row?.error).toContain('Data inválida')
    expect(row?.error).toContain('Tipo desconhecido')
    expect(row?.error).toContain('Valor inválido')
    expect(row?.error).toContain('Ativo não cadastrado')
    expect(row?.ticker).toBe('XXXX9')
    expect(row?.broker).toBe('XP')
  })

  it.each([
    ['jscp', 'JCP'],
    ['Dividendos', 'DIVIDENDO'],
    ['Rendimentos', 'RENDIMENTO'],
    ['JUROS SOBRE CAPITAL PROPRIO', 'JCP'],
    ['bonificação', 'BONIFICACAO'],
  ])('alias %s resolve para %s, ignorando maiúsculas', (input, expected) => {
    const rows = parseDividendCsvRows(
      `MXRF11\t01/03/2026\t${input}\t1,50\t0,00\tBRL\tXP`,
      registered,
    )
    expect(rows[0]?.type).toBe(expected)
    expect(rows[0]?.error).toBeNull()
  })

  it('formato brasileiro nos valores', () => {
    const rows = parseDividendCsvRows(
      'PETR4\t01/03/2026\tDIVIDENDO\t1.234,56\t100,50\tBRL\tXP',
      registered,
    )
    expect(rows[0]?.totalAmount).toBeCloseTo(1234.56, 3)
    expect(rows[0]?.taxWithheld).toBeCloseTo(100.5, 3)
    expect(rows[0]?.error).toBeNull()
  })

  it('IR retido vazio vira zero', () => {
    const rows = parseDividendCsvRows('PETR4\t01/03/2026\tDIVIDENDO\t1,50\t\tBRL\tXP', registered)
    expect(rows[0]?.taxWithheld).toBeCloseTo(0, 3)
    expect(rows[0]?.error).toBeNull()
  })

  it('coluna 7 ([ignorar]) é pulada', () => {
    const rows = parseDividendCsvRows(
      'PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP\tqualquer coisa\tNota real',
      registered,
    )
    expect(rows[0]?.notes).toBe('Nota real')
    expect(rows[0]?.error).toBeNull()
  })

  it('moeda inválida cai para BRL', () => {
    const rows = parseDividendCsvRows(
      'PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tEUR\tXP',
      registered,
    )
    expect(rows[0]?.currency).toBe('BRL')
    expect(rows[0]?.error).toBeNull()
  })

  it('csv vazio devolve lista vazia', () => {
    expect(parseDividendCsvRows('', registered)).toHaveLength(0)
  })

  it('ticker é normalizado para maiúsculas', () => {
    const rows = parseDividendCsvRows(
      'petr4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP',
      registered,
    )
    expect(rows[0]?.ticker).toBe('PETR4')
    expect(rows[0]?.error).toBeNull()
  })
})
