import { describe, expect, it } from 'vitest'
import { movimentacaoXlsx } from '../../../tests/xlsx.js'
import { readXlsxSheet } from '../xlsx/xlsx-reader.js'
import { dividendKey, markAlreadyImported, parseB3Movimentacao } from './b3-movimentacao.js'

/**
 * Dados fictícios de ponta a ponta: `TSTA3`, `TSTB3` e `TSTC11` não existem na B3.
 * O que os testes fixam é o formato do extrato, não a carteira de ninguém.
 */

const XP = 'XP INVESTIMENTOS CCTVM S/A.'
const TICKERS = new Set(['TSTA3', 'TSTB3', 'TSTC11'])

function parse(rows: readonly (readonly string[])[], tickers: ReadonlySet<string> = TICKERS) {
  return parseB3Movimentacao(readXlsxSheet(movimentacaoXlsx(rows)), tickers)
}

/** `Credito · data · movimentação · produto · instituição · qtd · PU · valor` */
function row(
  movement: string,
  product: string,
  amount: string,
  extra: Partial<{
    direction: string
    date: string
    quantity: string
    price: string
  }> = {},
) {
  return [
    extra.direction ?? 'Credito',
    extra.date ?? '10/06/2026',
    movement,
    product,
    XP,
    extra.quantity ?? '100',
    extra.price ?? '-',
    amount,
  ]
}

describe('parseB3Movimentacao', () => {
  it('mapeia cada movimentação de dinheiro para o tipo de provento', () => {
    const { rows } = parse([
      row('Rendimento', 'TSTC11 - FUNDO DE TESTE', '500'),
      row('Dividendo', 'TSTA3 - PAPEL DE TESTE A', '80'),
      row('Juros Sobre Capital Próprio', 'TSTB3 - PAPEL DE TESTE B', '30'),
      row('Empréstimo', 'TSTA3 - PAPEL DE TESTE A', '2.5'),
    ])

    // A ordem é a do arquivo — quem reordena para a revisão é o service.
    expect(rows.map((r) => [r.ticker, r.type, r.totalAmount])).toEqual([
      ['TSTC11', 'RENDIMENTO', 500],
      ['TSTA3', 'DIVIDENDO', 80],
      ['TSTB3', 'JCP', 30],
      ['TSTA3', 'BTC', 2.5],
    ])
  })

  it('usa o valor creditado, não quantidade × preço unitário', () => {
    // O PU da B3 vem bruto e arredondado a 3 casas: 100 × 0,172 daria 17,20, mas o que caiu
    // na conta foram 14,17 — o IR já entrou descontado e não é discriminado no extrato.
    const { rows } = parse([
      row('Juros Sobre Capital Próprio', 'TSTA3 - PAPEL DE TESTE A', '14.17', { price: '0.172' }),
    ])

    expect(rows[0]).toMatchObject({ totalAmount: 14.17, taxWithheld: 0, currency: 'BRL' })
  })

  it('descarta a perna em ações do empréstimo e fica só com a taxa', () => {
    // O BTC vem em duas linhas: uma com as ações emprestadas e sem valor, outra com o
    // aluguel recebido. Importar as duas dobraria o provento.
    const { rows, discarded } = parse([
      row('Empréstimo', 'TSTA3 - PAPEL DE TESTE A', '-', { quantity: '2200' }),
      row('Empréstimo', 'TSTA3 - PAPEL DE TESTE A', '0.33', { quantity: '0' }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.totalAmount).toBe(0.33)
    expect(discarded).toBe(1)
  })

  it('descarta movimentação de custódia e débito', () => {
    const { rows, discarded } = parse([
      row('Transferência', 'TSTA3 - PAPEL DE TESTE A', '-'),
      row('Transferência', 'TSTA3 - PAPEL DE TESTE A', '-', { direction: 'Debito' }),
      row('Cessão de Direitos', 'TSTA3 - PAPEL DE TESTE A', '-'),
      row('Direitos de Subscrição - Não Exercido', 'TSTA3 - PAPEL DE TESTE A', '-', {
        direction: 'Debito',
      }),
    ])

    expect(rows).toEqual([])
    expect(discarded).toBe(4)
  })

  it('avisa no reembolso, que pode ser dividendo ou JCP disfarçado', () => {
    const { rows } = parse([row('Reembolso', 'TSTA3 - PAPEL DE TESTE A', '256.4')])

    expect(rows[0]).toMatchObject({ type: 'DIVIDENDO', skipByDefault: false })
    expect(rows[0]?.warning).toMatch(/dividendo ou JCP/)
  })

  it('marca restituição de capital para ignorar — reduz preço médio, não é provento', () => {
    const { rows } = parse([row('Restituição de Capital', 'TSTA3 - PAPEL DE TESTE A', '380.52')])

    expect(rows[0]).toMatchObject({ skipByDefault: true })
    expect(rows[0]?.warning).toMatch(/Restituição de capital/)
  })

  it('mostra movimentação desconhecida em vez de descartar calado', () => {
    // Layout novo da B3 não pode sumir na contagem: aparece na tela, marcado para ignorar.
    const { rows, discarded } = parse([row('Amortização', 'TSTC11 - FUNDO DE TESTE', '42')])

    expect(discarded).toBe(0)
    expect(rows[0]).toMatchObject({ skipByDefault: true })
    expect(rows[0]?.warning).toMatch(/não reconhecida: Amortização/)
  })

  it('marca erro em ativo não cadastrado', () => {
    const { rows } = parse([row('Dividendo', 'XXXX9 - PAPEL DE FORA', '10')], new Set(['TSTA3']))

    expect(rows[0]?.error).toBe('Ativo não cadastrado: XXXX9')
  })

  it('marca erro em produto sem código de negociação', () => {
    const { rows } = parse([row('Rendimento', 'Tesouro IPCA+ 2029', '10')])

    expect(rows[0]?.error).toMatch(/Ticker não identificado/)
  })

  it('converte data e corretora para o formato do banco', () => {
    const { rows } = parse([
      row('Dividendo', 'TSTA3 - PAPEL DE TESTE A', '80', { date: '01/07/2026' }),
    ])

    expect(rows[0]).toMatchObject({ date: '2026-07-01', broker: 'XP', notes: 'CEI-Movimentação' })
  })

  it('recusa planilha que não é o extrato de Movimentação', () => {
    expect(() => parseB3Movimentacao([['Ticker', 'Data']], TICKERS)).toThrow(
      /extrato de Movimentação da B3/,
    )
  })
})

describe('markAlreadyImported', () => {
  const alreadyThere = (
    rows: readonly { ticker: string; date: string; type: string; totalAmount: number }[],
  ) => new Set(rows.map((r) => dividendKey(r.ticker, r.date, r.type, r.totalAmount)))

  it('marca para ignorar o que já está no banco', () => {
    const { rows } = parse([row('Dividendo', 'TSTA3 - PAPEL DE TESTE A', '80')])
    const marked = markAlreadyImported(rows, alreadyThere(rows))

    expect(marked[0]).toMatchObject({ skipByDefault: true, warning: 'Já importado' })
  })

  it('não confunde dois créditos do mesmo dia e papel com valores diferentes', () => {
    // Dois aluguéis no mesmo dia são dois eventos de verdade; só o valor os separa.
    const { rows } = parse([
      row('Empréstimo', 'TSTA3 - PAPEL DE TESTE A', '2.77'),
      row('Empréstimo', 'TSTA3 - PAPEL DE TESTE A', '0.74'),
    ])
    const marked = markAlreadyImported(rows, alreadyThere([rows[0] as (typeof rows)[number]]))

    expect(marked.map((r) => r.skipByDefault)).toEqual([true, false])
  })

  it('preserva o aviso que a linha já tinha', () => {
    const { rows } = parse([row('Reembolso', 'TSTA3 - PAPEL DE TESTE A', '80')])
    const marked = markAlreadyImported(rows, alreadyThere(rows))

    expect(marked[0]?.warning).toMatch(/^Já importado · Reembolso/)
  })
})
