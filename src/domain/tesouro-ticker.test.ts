import { describe, expect, it } from 'vitest'
import { isoDate } from '../shared/iso-date.js'
import type { TesouroRow } from './csv/tesouro-csv.js'
import {
  isTesouroTicker,
  parseTesouroShortCode,
  resolveTesouroCode,
  tesouroAssetName,
} from './tesouro-ticker.js'

const row = (tipoTitulo: string, dataVencimento: string): TesouroRow => ({
  tipoTitulo,
  dataVencimento,
  dataBase: isoDate('2024-03-01'),
  puCompraManha: 100,
})

const ROWS: TesouroRow[] = [
  row('Tesouro IPCA+', '15/08/2026'),
  row('Tesouro IPCA+ com Juros Semestrais', '15/08/2026'),
  row('Tesouro IPCA+', '15/05/2035'),
  row('Tesouro IPCA+ com Juros Semestrais', '15/05/2035'),
  row('Tesouro Selic', '01/03/2027'),
  row('Tesouro Selic', '07/03/2017'),
  row('Tesouro Prefixado', '01/10/2009'),
  row('Tesouro Prefixado', '01/01/2009'),
  row('Tesouro Prefixado', '01/07/2009'),
  row('Tesouro Educa+', '15/12/2030'),
  row('Tesouro Renda+ Aposentadoria Extra', '15/12/2045'),
  row('Tesouro IGPM+ com Juros Semestrais', '01/04/2021'),
]

describe('isTesouroTicker', () => {
  it('reconhece o código curto e o código do CSV', () => {
    expect(isTesouroTicker('TD:IPCA2026')).toBe(true)
    expect(isTesouroTicker('Tesouro Selic;01/03/2027')).toBe(true)
  })

  it('não reconhece ticker de ação', () => {
    expect(isTesouroTicker('PETR4')).toBe(false)
    expect(isTesouroTicker('BTC-USD')).toBe(false)
  })
})

describe('parseTesouroShortCode', () => {
  it('IPCA sem sufixo é o título principal, sem juros semestrais', () => {
    expect(parseTesouroShortCode('TD:IPCA2026')).toEqual({
      title: 'Tesouro IPCA+',
      year: '2026',
    })
  })

  it('o sufixo J marca o título com juros semestrais', () => {
    expect(parseTesouroShortCode('TD:IPCAJ2035')).toEqual({
      title: 'Tesouro IPCA+ com Juros Semestrais',
      year: '2035',
    })
    expect(parseTesouroShortCode('TD:PREJ2010')?.title).toBe(
      'Tesouro Prefixado com Juros Semestrais',
    )
  })

  it('cobre os demais títulos', () => {
    expect(parseTesouroShortCode('TD:SELIC2027')?.title).toBe('Tesouro Selic')
    expect(parseTesouroShortCode('TD:PRE2029')?.title).toBe('Tesouro Prefixado')
    expect(parseTesouroShortCode('TD:EDUCA2030')?.title).toBe('Tesouro Educa+')
    expect(parseTesouroShortCode('TD:RENDA2045')?.title).toBe('Tesouro Renda+ Aposentadoria Extra')
    expect(parseTesouroShortCode('TD:IGPM2021')?.title).toBe('Tesouro IGPM+ com Juros Semestrais')
  })

  it('aceita minúsculas e espaços', () => {
    expect(parseTesouroShortCode('  td:selic2027 ')?.title).toBe('Tesouro Selic')
  })

  it('recusa prefixo ausente, código desconhecido e ano inválido', () => {
    expect(parseTesouroShortCode('PETR4')).toBeNull()
    expect(parseTesouroShortCode('TD:CDB2026')).toBeNull()
    expect(parseTesouroShortCode('TD:IPCA')).toBeNull()
    expect(parseTesouroShortCode('TD:IPCA26')).toBeNull()
  })
})

describe('resolveTesouroCode', () => {
  it('traduz o código curto para o código do CSV', () => {
    expect(resolveTesouroCode(ROWS, 'TD:IPCA2026')?.code).toBe('Tesouro IPCA+;15/08/2026')
    expect(resolveTesouroCode(ROWS, 'TD:SELIC2027')?.code).toBe('Tesouro Selic;01/03/2027')
  })

  it('acha o vencimento mesmo quando o dia não é o usual', () => {
    // A Selic 2017 vence em 07/03, não em 01/03 como as demais.
    expect(resolveTesouroCode(ROWS, 'TD:SELIC2017')?.maturity).toBe('07/03/2017')
  })

  it('separa o título principal do de juros semestrais no mesmo vencimento', () => {
    expect(resolveTesouroCode(ROWS, 'TD:IPCA2035')?.code).toBe('Tesouro IPCA+;15/05/2035')
    expect(resolveTesouroCode(ROWS, 'TD:IPCAJ2035')?.code).toBe(
      'Tesouro IPCA+ com Juros Semestrais;15/05/2035',
    )
  })

  it('com vários vencimentos no ano escolhe o primeiro e devolve o resto', () => {
    const resolved = resolveTesouroCode(ROWS, 'TD:PRE2009')

    expect(resolved?.maturity).toBe('01/01/2009')
    expect(resolved?.alternatives).toEqual(['01/07/2009', '01/10/2009'])
  })

  it('no caso comum não há alternativa nenhuma', () => {
    expect(resolveTesouroCode(ROWS, 'TD:SELIC2027')?.alternatives).toEqual([])
  })

  it('aceita o código do CSV direto e confirma que ele existe', () => {
    expect(resolveTesouroCode(ROWS, 'Tesouro Selic;01/03/2027')?.code).toBe(
      'Tesouro Selic;01/03/2027',
    )
    expect(resolveTesouroCode(ROWS, 'Tesouro Selic;01/03/2099')).toBeNull()
  })

  it('devolve null para ano sem título e para ticker que não é do Tesouro', () => {
    expect(resolveTesouroCode(ROWS, 'TD:IPCA2099')).toBeNull()
    expect(resolveTesouroCode(ROWS, 'PETR4')).toBeNull()
  })
})

describe('tesouroAssetName', () => {
  it('junta título e vencimento', () => {
    expect(tesouroAssetName('Tesouro IPCA+', '15/08/2026')).toBe('Tesouro IPCA+ 15/08/2026')
  })
})
