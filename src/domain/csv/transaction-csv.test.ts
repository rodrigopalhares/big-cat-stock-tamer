import { describe, expect, it } from 'vitest'
import { parseBrazilianNumber } from './br-number.js'
import { type AssetStatus, extractDistinctTickers, parseCsvRows } from './transaction-csv.js'

// Porte de src/test/kotlin/com/stocks/service/CsvParsingServiceTest.kt

const existingTickers = new Set(['PETR4', 'VALE3'])
const resolver = (): AssetStatus => 'WILL_CREATE'

describe('parseBrazilianNumber', () => {
  it('decimal simples com vírgula', () => {
    expect(parseBrazilianNumber('25,50')).toBe(25.5)
  })

  it('separador de milhar com ponto', () => {
    expect(parseBrazilianNumber('1.234,56')).toBe(1234.56)
  })

  it('inteiro sem separador', () => {
    expect(parseBrazilianNumber('100')).toBe(100)
  })

  it('string em branco vira zero', () => {
    expect(parseBrazilianNumber('')).toBe(0)
    expect(parseBrazilianNumber('   ')).toBe(0)
  })

  it('remove espaços em volta', () => {
    expect(parseBrazilianNumber('  25,50  ')).toBe(25.5)
  })

  it('entrada inválida devolve null', () => {
    expect(parseBrazilianNumber('abc')).toBeNull()
  })

  it('número negativo', () => {
    expect(parseBrazilianNumber('-100,50')).toBe(-100.5)
  })

  it('número grande com vários separadores de milhar', () => {
    expect(parseBrazilianNumber('1.000.000,00')).toBe(1000000)
  })
})

describe('parseCsvRows', () => {
  it('linha de compra válida', () => {
    const csv = 'PETR4\t01/06/2024\tC\t100\t25,50\t10,00\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ticker: 'PETR4',
      date: '2024-06-01',
      type: 'BUY',
      quantity: 100,
      price: 25.5,
      fees: 10,
      broker: 'XP',
      currency: 'BRL',
      assetStatus: 'EXISTS',
      error: null,
    })
  })

  it('linha de venda válida', () => {
    const csv = 'VALE3\t15/03/2024\tV\t50\t60,00\t5,00\tClear\t0\tBRL\tvenda parcial'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]).toMatchObject({
      type: 'SELL',
      notes: 'venda parcial',
      assetStatus: 'EXISTS',
    })
  })

  it('IRRF é somado às taxas e anexado às observações', () => {
    const csv = 'PETR4\t01/06/2024\tV\t100\t30,00\t10,00\tXP\t2,31\tBRL\tvenda'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.fees).toBe(12.31)
    expect(rows[0]?.notes).toContain('IRRF: 2,31')
    expect(rows[0]?.notes).toContain('venda')
  })

  it('IRRF em observação vazia não deixa espaço à esquerda', () => {
    const csv = 'PETR4\t01/06/2024\tV\t100\t30,00\t10,00\tXP\t5,00\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.notes).toBe('IRRF: 5,00')
  })

  it('quantidade negativa vira absoluta e depois negativa na venda', () => {
    const csv = 'PETR4\t01/06/2024\tV\t-100\t30,00\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.quantity).toBe(-100)
  })

  it('data inválida gera linha com erro', () => {
    const csv = 'PETR4\t2024-06-01\tC\t100\t25,50\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toContain('Data inválida')
  })

  it('linhas em branco são ignoradas', () => {
    const csv =
      'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t\n\n\nVALE3\t02/06/2024\tC\t50\t60,00\t0\tClear\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows).toHaveLength(2)
    expect(rows[0]?.ticker).toBe('PETR4')
    expect(rows[1]?.ticker).toBe('VALE3')
  })

  it('ticker desconhecido recebe o status do resolver', () => {
    const csv = 'GRND3\t01/06/2024\tC\t100\t5,00\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, new Set(['PETR4']), resolver)

    expect(rows[0]?.assetStatus).toBe('WILL_CREATE')
  })

  it('ticker existente recebe EXISTS', () => {
    const csv = 'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.assetStatus).toBe('EXISTS')
  })

  it('resolver é chamado uma única vez por ticker desconhecido', () => {
    let callCount = 0
    const counting = (): AssetStatus => {
      callCount++
      return 'WILL_CREATE'
    }

    const csv =
      'GRND3\t01/06/2024\tC\t100\t5,00\t0\tXP\t0\tBRL\t\nGRND3\t02/06/2024\tC\t200\t5,50\t0\tXP\t0\tBRL\t'
    parseCsvRows(csv, new Set(), counting)

    expect(callCount).toBe(1)
  })

  it('resolver não é chamado para ticker já existente', () => {
    let callCount = 0
    const counting = (): AssetStatus => {
      callCount++
      return 'WILL_CREATE'
    }

    parseCsvRows('PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t', existingTickers, counting)

    expect(callCount).toBe(0)
  })

  it('formato brasileiro com separador de milhar', () => {
    const csv = 'PETR4\t01/06/2024\tC\t1.000\t1.234,56\t10,00\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.quantity).toBe(1000)
    expect(rows[0]?.price).toBe(1234.56)
  })

  it('colunas insuficientes geram erro', () => {
    const rows = parseCsvRows('PETR4\t01/06/2024\tC', existingTickers, resolver)

    expect(rows[0]?.error).toContain('Colunas insuficientes')
  })

  it('tipo inválido preserva os campos válidos', () => {
    const csv = 'PETR4\t01/06/2024\tX\t100\t25,50\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toContain('Tipo inválido')
    expect(rows[0]?.date).toBe('2024-06-01')
    expect(rows[0]?.quantity).toBe(100)
    expect(rows[0]?.price).toBe(25.5)
  })

  it('csv vazio devolve lista vazia', () => {
    expect(parseCsvRows('', existingTickers, resolver)).toEqual([])
    expect(parseCsvRows('  \n  \n  ', existingTickers, resolver)).toEqual([])
  })

  it('ticker em branco gera linha com erro', () => {
    const csv = ' \t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toContain('Ticker vazio')
  })

  it('quantidade zero gera erro', () => {
    const csv = 'PETR4\t01/06/2024\tC\t0\t25,50\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toContain('Quantidade deve ser > 0')
  })

  it('preço zero é aceito', () => {
    const csv = 'PETR4\t01/06/2024\tC\t100\t0\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toBeNull()
    expect(rows[0]?.price).toBe(0)
  })

  it('preço negativo gera erro', () => {
    const csv = 'PETR4\t01/06/2024\tC\t100\t-5,00\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toContain('Preço deve ser >= 0')
  })

  it('vários erros acumulam na mesma linha', () => {
    const csv = 'PETR4\t01/06/2024\tX\tabc\t25,50\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toContain('Tipo inválido')
    expect(rows[0]?.error).toContain('Quantidade inválida')
    expect(rows[0]?.date).toBe('2024-06-01')
    expect(rows[0]?.price).toBe(25.5)
  })

  it('moeda inválida cai para BRL', () => {
    const csv = 'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tEUR\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.currency).toBe('BRL')
  })

  it('moeda USD é aceita', () => {
    const csv = 'AAPL\t01/06/2024\tC\t10\t150,00\t0\tIBKR\t0\tUSD\t'
    const rows = parseCsvRows(csv, new Set(), resolver)

    expect(rows[0]?.currency).toBe('USD')
  })

  it('tipos em inglês são aceitos', () => {
    const buy = 'PETR4\t01/06/2024\tBUY\t100\t25,50\t0\tXP\t0\tBRL\t'
    const sell = 'PETR4\t01/06/2024\tSELL\t100\t25,50\t0\tXP\t0\tBRL\t'

    expect(parseCsvRows(buy, existingTickers, resolver)[0]?.type).toBe('BUY')
    expect(parseCsvRows(sell, existingTickers, resolver)[0]?.type).toBe('SELL')
  })

  it('eventos societários têm letra própria', () => {
    const row = (type: string) => `PETR4\t01/06/2024\t${type}\t10\t0\t0\tXP\t0\tBRL\t`

    expect(parseCsvRows(row('B'), existingTickers, resolver)[0]?.type).toBe('BONIFICACAO')
    expect(parseCsvRows(row('BN'), existingTickers, resolver)[0]?.type).toBe('BONIFICACAO')
    expect(parseCsvRows(row('D'), existingTickers, resolver)[0]?.type).toBe('DESDOBRAMENTO')
    expect(parseCsvRows(row('A'), existingTickers, resolver)[0]?.type).toBe('AGRUPAMENTO')
  })

  it('nomes por extenso e os apelidos das corretoras também são aceitos', () => {
    const row = (type: string) => `PETR4\t01/06/2024\t${type}\t10\t0\t0\tXP\t0\tBRL\t`

    expect(parseCsvRows(row('BONIFICAÇÃO'), existingTickers, resolver)[0]?.type).toBe('BONIFICACAO')
    expect(parseCsvRows(row('SPLIT'), existingTickers, resolver)[0]?.type).toBe('DESDOBRAMENTO')
    expect(parseCsvRows(row('GRUPAMENTO'), existingTickers, resolver)[0]?.type).toBe('AGRUPAMENTO')
    expect(parseCsvRows(row('INPLIT'), existingTickers, resolver)[0]?.type).toBe('AGRUPAMENTO')
    expect(parseCsvRows(row('COMPRA'), existingTickers, resolver)[0]?.type).toBe('BUY')
    expect(parseCsvRows(row('VENDA'), existingTickers, resolver)[0]?.type).toBe('SELL')
  })

  it('redução de capital atende por R.CAP', () => {
    const row = (type: string) => `PETR4\t01/06/2024\t${type}\t100\t2,00\t0\tXP\t0\tBRL\t`

    expect(parseCsvRows(row('R.CAP'), existingTickers, resolver)[0]).toMatchObject({
      type: 'REDUCAO_CAPITAL',
      quantity: 100,
      price: 2,
      error: null,
    })
    expect(parseCsvRows(row('RCAP'), existingTickers, resolver)[0]?.type).toBe('REDUCAO_CAPITAL')
    expect(parseCsvRows(row('REDUÇÃO DE CAPITAL'), existingTickers, resolver)[0]?.type).toBe(
      'REDUCAO_CAPITAL',
    )
  })

  it('só o agrupamento sai com quantidade negativa', () => {
    const row = (type: string) => `PETR4\t01/06/2024\t${type}\t10\t0\t0\tXP\t0\tBRL\t`

    expect(parseCsvRows(row('B'), existingTickers, resolver)[0]?.quantity).toBe(10)
    expect(parseCsvRows(row('D'), existingTickers, resolver)[0]?.quantity).toBe(10)
    expect(parseCsvRows(row('A'), existingTickers, resolver)[0]?.quantity).toBe(-10)
  })

  it('desdobramento sem preço não é erro', () => {
    const csv = 'PETR4\t01/06/2024\tD\t100\t\t\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toBeNull()
    expect(rows[0]).toMatchObject({ type: 'DESDOBRAMENTO', quantity: 100, price: 0 })
  })

  it('bonificação carrega o custo unitário atribuído na coluna de preço', () => {
    const csv = 'PETR4\t01/06/2024\tB\t10\t5,00\t0\tXP\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]).toMatchObject({ type: 'BONIFICACAO', quantity: 10, price: 5, error: null })
  })

  it('colunas opcionais ausentes usam os padrões', () => {
    const csv = 'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows[0]?.error).toBeNull()
    expect(rows[0]?.currency).toBe('BRL')
    expect(rows[0]?.notes).toBe('')
  })

  it('rowIndex acompanha a lista já sem as linhas em branco', () => {
    const csv =
      'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t\n\nVALE3\t02/06/2024\tC\t50\t60,00\t0\tClear\t0\tBRL\t'
    const rows = parseCsvRows(csv, existingTickers, resolver)

    expect(rows.map((r) => r.rowIndex)).toEqual([0, 1])
  })
})

describe('extractDistinctTickers', () => {
  it('devolve tickers únicos na ordem de aparição', () => {
    const csv =
      'vale3\t01/06/2024\tC\t1\t1\t0\tXP\t0\tBRL\t\nPETR4\t02/06/2024\tC\t1\t1\t0\tXP\t0\tBRL\t\nVALE3\t03/06/2024\tC\t1\t1\t0\tXP\t0\tBRL\t'
    expect(extractDistinctTickers(csv)).toEqual(['VALE3', 'PETR4'])
  })

  it('ignora linhas em branco e ticker vazio', () => {
    expect(extractDistinctTickers('\n \n \t01/06/2024\tC\t1\t1\t0\tXP\t0\tBRL\t')).toEqual([])
  })
})
