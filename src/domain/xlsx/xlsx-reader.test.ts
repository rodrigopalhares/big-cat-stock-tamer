import { describe, expect, it } from 'vitest'
import { buildXlsx } from '../../../tests/xlsx.js'
import { readXlsxSheet } from './xlsx-reader.js'

describe('readXlsxSheet', () => {
  it('lê texto e número da planilha', () => {
    const sheet = readXlsxSheet(
      buildXlsx([
        ['Produto', 'Valor'],
        ['TESTE3 - PAPEL DE TESTE', '123.45'],
      ]),
    )

    expect(sheet).toEqual([
      ['Produto', 'Valor'],
      ['TESTE3 - PAPEL DE TESTE', '123.45'],
    ])
  })

  it('alinha pela referência da célula, porque célula vazia não é gravada no XML', () => {
    const sheet = readXlsxSheet(buildXlsx([['A', '', 'C']]))

    // Sem o alinhamento, o `C` viraria a segunda coluna e todo o resto da linha andaria.
    expect(sheet[0]).toEqual(['A', '', 'C'])
  })

  it('desfaz as entidades XML do texto', () => {
    const sheet = readXlsxSheet(buildXlsx([['ISHARES S&P 500 <FDO> "X"']]))

    expect(sheet[0]?.[0]).toBe('ISHARES S&P 500 <FDO> "X"')
  })

  it('recusa arquivo que não é zip', () => {
    expect(() => readXlsxSheet(new TextEncoder().encode('isto não é uma planilha'))).toThrow(
      /não é um \.xlsx válido/,
    )
  })
})
