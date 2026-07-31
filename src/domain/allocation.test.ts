import { describe, expect, it } from 'vitest'
import {
  type AllocationAssetInput,
  type AllocationClassInput,
  buildAllocation,
} from './allocation.js'

const ACOES: AllocationClassInput = { id: 1, name: 'Ações', targetPercent: 40, color: '#36a2eb' }
const FII: AllocationClassInput = { id: 2, name: 'Fii', targetPercent: 30, color: '#9966ff' }
const CRYPTO: AllocationClassInput = { id: 3, name: 'Crypto', targetPercent: 30, color: '#ff6384' }

function asset(ticker: string, marketValue: number, classId: number | null): AllocationAssetInput {
  return { ticker, name: ticker, type: 'STOCK', classId, marketValue }
}

describe('buildAllocation', () => {
  it('soma o patrimônio e os percentuais de cada classe', () => {
    const result = buildAllocation(
      [ACOES, FII],
      [asset('PETR4', 600, 1), asset('VALE3', 200, 1), asset('HGLG11', 200, 2)],
    )

    expect(result.totalValue).toBe(1000)
    expect(result.totalTarget).toBe(70)

    const acoes = result.classes.find((c) => c.name === 'Ações')
    expect(acoes?.currentValue).toBe(800)
    expect(acoes?.currentPercent).toBe(80)
    expect(acoes?.deviation).toBe(40)
    expect(acoes?.rebalanceAmount).toBe(-400)
  })

  it('ordena quem está abaixo da meta primeiro, e quem passou dela no fim', () => {
    // Crypto 0% (meta 30 ⇒ −30), Fii 20% (meta 30 ⇒ −10), Ações 80% (meta 40 ⇒ +40).
    // O aporte vai para Crypto, não para Ações — que está mais fora do lugar em módulo.
    const result = buildAllocation(
      [ACOES, FII, CRYPTO],
      [asset('PETR4', 800, 1), asset('HGLG11', 200, 2)],
    )

    expect(result.classes.map((c) => c.name)).toEqual(['Crypto', 'Fii', 'Ações'])
    expect(result.classes.map((c) => Math.round(c.deviation))).toEqual([-30, -10, 40])
  })

  it('entre as que passaram da meta, a menos excedida vem antes', () => {
    const result = buildAllocation(
      [
        { ...ACOES, targetPercent: 10 },
        { ...FII, targetPercent: 20 },
      ],
      [asset('PETR4', 500, 1), asset('HGLG11', 500, 2)],
    )

    // Ações +40, Fii +30 ⇒ Fii antes de Ações.
    expect(result.classes.map((c) => c.name)).toEqual(['Fii', 'Ações'])
  })

  it('classe abaixo da meta tem desvio negativo e aporte positivo', () => {
    const result = buildAllocation([ACOES], [asset('PETR4', 200, 1), asset('BTC', 800, null)])

    const acoes = result.classes.find((c) => c.name === 'Ações')
    expect(acoes?.currentPercent).toBe(20)
    expect(acoes?.deviation).toBe(-20)
    // Meta 40% de 1000 = 400; tem 200 ⇒ faltam 200.
    expect(acoes?.rebalanceAmount).toBe(200)
  })

  it('ativos da classe saem do menor para o maior valor de mercado', () => {
    const result = buildAllocation(
      [ACOES],
      [asset('PETR4', 500, 1), asset('WEGE3', 100, 1), asset('VALE3', 300, 1)],
    )

    const acoes = result.classes[0]
    expect(acoes?.assets.map((a) => a.ticker)).toEqual(['WEGE3', 'VALE3', 'PETR4'])
  })

  it('calcula o peso do ativo na classe e no patrimônio', () => {
    const result = buildAllocation(
      [ACOES, FII],
      [asset('PETR4', 750, 1), asset('VALE3', 250, 1), asset('HGLG11', 1000, 2)],
    )

    const petr = result.classes.flatMap((c) => c.assets).find((a) => a.ticker === 'PETR4')
    expect(petr?.percentOfClass).toBe(75)
    expect(petr?.percentOfTotal).toBe(37.5)
  })

  it('o balde "Sem classe" fica no topo, mesmo sem meta a perseguir', () => {
    // Ações está 20 p.p. abaixo da meta; ainda assim o balde vem antes, porque ele é
    // pendência de cadastro e no fim de uma lista longa passaria despercebido.
    const result = buildAllocation([ACOES], [asset('PETR4', 400, 1), asset('BTC', 600, null)])

    expect(result.classes[0]?.name).toBe('Sem classe')
    expect(result.classes[0]?.id).toBeNull()
    expect(result.classes[0]?.targetPercent).toBe(0)
    expect(result.classes[0]?.assets.map((a) => a.ticker)).toEqual(['BTC'])
  })

  it('não cria o balde quando todo ativo tem classe', () => {
    const result = buildAllocation([ACOES], [asset('PETR4', 400, 1)])

    expect(result.classes.map((c) => c.name)).toEqual(['Ações'])
  })

  it('ativo apontando para classe inexistente cai no balde, sem sumir do total', () => {
    const result = buildAllocation([ACOES], [asset('PETR4', 400, 1), asset('XPTO', 100, 99)])

    expect(result.totalValue).toBe(500)
    expect(result.classes.find((c) => c.id === null)?.assets.map((a) => a.ticker)).toEqual(['XPTO'])
  })

  it('classe sem ativo aparece com a distância cheia', () => {
    const result = buildAllocation([ACOES, CRYPTO], [asset('PETR4', 1000, 1)])

    const crypto = result.classes.find((c) => c.name === 'Crypto')
    expect(crypto?.currentValue).toBe(0)
    expect(crypto?.distance).toBe(30)
    expect(crypto?.rebalanceAmount).toBe(300)
    expect(crypto?.assets).toEqual([])
  })

  it('carteira zerada não divide por zero', () => {
    const result = buildAllocation([ACOES, FII], [])

    expect(result.totalValue).toBe(0)
    expect(result.classes.every((c) => c.currentPercent === 0)).toBe(true)
    expect(result.classes.every((c) => c.rebalanceAmount === 0)).toBe(true)
    // Sem dinheiro, a distância é a própria meta — Ações (40) antes de Fii (30).
    expect(result.classes.map((c) => c.name)).toEqual(['Ações', 'Fii'])
  })

  it('sem classe cadastrada e sem ativo, não devolve nada', () => {
    expect(buildAllocation([], []).classes).toEqual([])
  })
})
