import { describe, expect, it } from 'vitest'
import { isoDate } from '../shared/iso-date.js'
import {
  allocateFees,
  type BrokerNoteData,
  checkTotal,
  checkWarning,
  groupTrades,
  isSubtotalFee,
  matchSecurity,
  type NoteTrade,
  normalizeSecurityName,
  resolveTotalFees,
  sumItemizedFees,
  summarizeNote,
  toCsv,
} from './broker-note.js'

/** As 19 execuções de XPLG11 da nota 140232205 da XP, em 15/07/2026. */
const XPLG11_TRADES: NoteTrade[] = [
  [43, 91.63],
  [29, 91.66],
  [10, 91.62],
  [8, 91.67],
  [32, 91.6],
  [6, 91.6],
  [100, 91.67],
  [11, 91.63],
  [8, 91.65],
  [8, 91.61],
  [11, 91.64],
  [2, 91.66],
  [2, 91.64],
  [20, 91.67],
  [1, 91.61],
  [5, 91.65],
  [11, 91.62],
  [11, 91.66],
  [11, 91.67],
].map(([quantity = 0, price = 0]) => ({
  ticker: 'XPLG11',
  security: 'FII XP LOG',
  tickerSource: 'NOTE' as const,
  side: 'C' as const,
  quantity,
  price,
}))

const XP_NOTE: BrokerNoteData = {
  date: isoDate('2026-07-15'),
  broker: 'XP',
  noteNumber: '140232205',
  totalFees: 9.03,
  totalAmount: 30160.98,
  trades: XPLG11_TRADES,
}

const trade = (
  ticker: string,
  quantity: number,
  price: number,
  side: 'C' | 'V' = 'C',
  security = ticker,
): NoteTrade => ({
  ticker,
  security,
  tickerSource: ticker === '' ? 'NONE' : 'NOTE',
  side,
  quantity,
  price,
})

describe('groupTrades', () => {
  it('junta as execuções do mesmo ticker num preço médio ponderado', () => {
    const [group] = groupTrades(XPLG11_TRADES)

    expect(group?.ticker).toBe('XPLG11')
    expect(group?.quantity).toBe(329)
    expect(group?.value).toBeCloseTo(30151.95, 2)
    expect(group?.price).toBeCloseTo(91.6472644, 6)
  })

  it('não mistura compra e venda do mesmo ticker', () => {
    const groups = groupTrades([trade('PETR4', 100, 30), trade('PETR4', 40, 31, 'V')])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.side)).toEqual(['C', 'V'])
  })

  it('normaliza o ticker e ignora linha sem papel nenhum', () => {
    const groups = groupTrades([trade(' xplg11 ', 10, 91), trade('', 5, 10)])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.ticker).toBe('XPLG11')
  })

  it('agrupa pelo nome quando a nota não imprime o código', () => {
    // A 139054003 traz só "CSU DIGITAL": sem isso cada execução viraria uma linha solta.
    const groups = groupTrades([
      trade('', 100, 15.15, 'C', 'CSU DIGITAL'),
      trade('', 600, 15.17, 'C', 'CSU DIGITAL'),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ ticker: '', security: 'CSU DIGITAL', tickerSource: 'NONE' })
    expect(groups[0]?.quantity).toBe(700)
  })
})

describe('normalizeSecurityName', () => {
  it.each([
    ['CSU DIGITAL ON NM', 'CSU DIGITAL'],
    ['CSU Digital S.A.', 'CSU DIGITAL'],
    ['MAHLE Metal Leve S.A.', 'MAHLE METAL LEVE'],
    ['FII XP LOG CI', 'XP LOG'],
    ['Petróleo Brasileiro S.A. - Petrobras', 'PETROLEO BRASILEIRO PETROBRAS'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeSecurityName(raw)).toBe(expected)
  })
})

describe('matchSecurity', () => {
  const ASSETS = [
    { ticker: 'CSUD3', name: 'CSU Digital S.A.' },
    { ticker: 'LEVE3', name: 'MAHLE Metal Leve S.A.' },
    { ticker: 'GGBR3', name: 'Gerdau S.A.' },
    { ticker: 'GGBR4', name: 'Gerdau S.A.' },
    { ticker: 'ITSA3', name: 'Itaúsa S.A.' },
    { ticker: 'XXXX3', name: null },
  ]

  it('casa o nome exato depois de normalizar', () => {
    expect(matchSecurity('CSU DIGITAL', ASSETS)).toBe('CSUD3')
  })

  it('casa o nome abreviado da nota', () => {
    expect(matchSecurity('METAL LEVE', ASSETS)).toBe('LEVE3')
  })

  it('recusa nome ambíguo em vez de chutar', () => {
    // "GERDAU" é o nome de GGBR3 e GGBR4: escolher uma classe seria chutar.
    expect(matchSecurity('GERDAU', ASSETS)).toBeNull()
  })

  it('ignora o acento na comparação', () => {
    expect(matchSecurity('ITAUSA', ASSETS)).toBe('ITSA3')
  })

  it('devolve null para papel que não está cadastrado', () => {
    expect(matchSecurity('EMPRESA DESCONHECIDA', ASSETS)).toBeNull()
  })

  it('devolve null para nome vazio', () => {
    expect(matchSecurity('   ', ASSETS)).toBeNull()
  })
})

describe('allocateFees', () => {
  it('rateia proporcionalmente ao valor operado, não à quantidade', () => {
    // ITSA4 tem o dobro de cotas, mas metade do valor: o rateio segue o valor.
    const groups = groupTrades([trade('XPLG11', 100, 90), trade('ITSA4', 200, 15)])
    const [xplg, itsa] = allocateFees(groups, 12)

    expect(xplg?.fees).toBe(9)
    expect(itsa?.fees).toBe(3)
  })

  it('joga o resíduo do arredondamento no ticker de maior valor', () => {
    const groups = groupTrades([
      trade('AAAA3', 1, 100),
      trade('BBBB3', 1, 100),
      trade('CCCC3', 1, 100),
    ])
    const allocated = allocateFees(groups, 0.1)

    // 0,10 / 3 = 0,0333… → 0,03 cada e um centavo sobrando.
    expect(allocated.map((g) => g.fees)).toEqual([0.04, 0.03, 0.03])
    expect(allocated.reduce((sum, g) => sum + g.fees, 0)).toBeCloseTo(0.1, 10)
  })

  it('mantém a soma exata das taxas com qualquer quantidade de tickers', () => {
    const groups = groupTrades([
      trade('AAAA3', 7, 13.37),
      trade('BBBB3', 3, 101.11),
      trade('CCCC3', 41, 2.03),
      trade('DDDD3', 12, 55.5),
    ])
    const total = allocateFees(groups, 17.77).reduce((sum, g) => sum + g.fees, 0)

    expect(total).toBeCloseTo(17.77, 10)
  })

  it('devolve taxa zero quando a nota não cobrou nada', () => {
    const allocated = allocateFees(groupTrades([trade('XPLG11', 10, 90)]), 0)

    expect(allocated[0]?.fees).toBe(0)
  })

  it('não quebra com nota sem operações', () => {
    expect(allocateFees([], 10)).toEqual([])
  })
})

describe('sumItemizedFees', () => {
  /** O Resumo Financeiro da nota 139054003: três parcelas e um subtotal no meio. */
  const FEES = [
    { label: 'Taxa de liquidação', value: 6.35 },
    { label: 'Emolumentos', value: 1.41 },
    { label: 'Taxa de Transf. de Ativos', value: 0.73 },
    { label: 'Total Bovespa / Soma', value: 2.14 },
  ]

  it('descarta o subtotal que repete as parcelas', () => {
    // Somar tudo daria 10,63 e a nota fecharia R$ 2,14 acima do líquido declarado.
    expect(sumItemizedFees(FEES)).toBe(8.49)
  })

  it('corrige o total quando o subtotal foi somado junto', () => {
    expect(resolveTotalFees(FEES, 10.63)).toBe(8.49)
  })

  it('mantém o total declarado quando a lista de taxas está incompleta', () => {
    // 6,75 sozinho não explica 9,03: faltam parcelas, e subtrair aqui seria pior.
    expect(resolveTotalFees([{ label: 'Taxa de liquidação', value: 6.75 }], 9.03)).toBe(9.03)
  })

  it('não mexe numa nota sem subtotal na lista', () => {
    const fees = [
      { label: 'Taxa de liquidação', value: 6.75 },
      { label: 'Emolumentos', value: 1.5 },
      { label: 'Taxa de Transf. de Ativos', value: 0.78 },
    ]

    expect(resolveTotalFees(fees, 9.03)).toBe(9.03)
  })

  it.each(['Total CBLC', 'Total Bovespa / Soma', 'Total Custos / Despesas', ' total geral'])(
    'reconhece "%s" como subtotal',
    (label) => {
      expect(isSubtotalFee(label)).toBe(true)
    },
  )

  it.each(['Taxa de liquidação', 'Emolumentos', 'Taxa Operacional', 'I.R.R.F. s/ operações'])(
    'não confunde "%s" com subtotal',
    (label) => {
      expect(isSubtotalFee(label)).toBe(false)
    },
  )

  it('devolve zero quando a nota não cobrou taxa', () => {
    expect(sumItemizedFees([])).toBe(0)
  })
})

describe('checkTotal', () => {
  it('confere a nota de compra: valor operado mais as taxas', () => {
    const check = checkTotal(summarizeNote(XP_NOTE), XP_NOTE)

    expect(check.ok).toBe(true)
    expect(check.calculated).toBe(30160.98)
    expect(check.difference).toBe(0)
    expect(checkWarning(check)).toBeNull()
  })

  it('confere a nota de venda: valor operado menos as taxas', () => {
    const note: BrokerNoteData = {
      ...XP_NOTE,
      totalFees: 10,
      totalAmount: 2990,
      trades: [trade('PETR4', 100, 30, 'V')],
    }

    expect(checkTotal(summarizeNote(note), note).ok).toBe(true)
  })

  it('acusa diferença quando o total declarado não bate', () => {
    const note: BrokerNoteData = { ...XP_NOTE, totalAmount: 30200 }
    const check = checkTotal(summarizeNote(note), note)

    expect(check.ok).toBe(false)
    expect(check.difference).toBeCloseTo(-39.02, 2)
    expect(checkWarning(check)).toContain('30200.00')
  })
})

describe('toCsv', () => {
  it('gera a linha no formato da importação de transações', () => {
    const csv = toCsv(XP_NOTE, summarizeNote(XP_NOTE))

    expect(csv).toBe('XPLG11\t15/07/2026\tC\t329\t91,64726444\t9,03\tXP\t0\tBRL\tNota 140232205')
  })

  it('gera uma linha por ticker', () => {
    const note: BrokerNoteData = {
      ...XP_NOTE,
      totalFees: 12,
      trades: [trade('XPLG11', 100, 90), trade('ITSA4', 200, 15)],
    }

    expect(toCsv(note, summarizeNote(note)).split('\n')).toHaveLength(2)
  })

  it('deixa a observação vazia quando a nota não tem número', () => {
    const note: BrokerNoteData = { ...XP_NOTE, noteNumber: '' }

    expect(toCsv(note, summarizeNote(note)).endsWith('\tBRL\t')).toBe(true)
  })
})
