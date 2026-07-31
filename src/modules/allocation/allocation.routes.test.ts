import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../../../tests/app-harness.js'
import { clearAllData } from '../../../tests/db.js'
import { createAsset, createAssetClass, createPriceHistory } from '../../../tests/factories.js'
import { HttpResponse, http, server, TESOURO_CSV } from '../../../tests/msw.js'
import type { Allocation } from '../../domain/allocation.js'
import { today } from '../../shared/iso-date.js'

/**
 * A posição é montada direto no ativo (quantidade + preço médio) e o preço do dia vai
 * para o price_history: com cotação de hoje no banco, o portfólio não chama o Yahoo e o
 * teste fica sobre a alocação, não sobre a rede.
 */
async function position(h: Harness, ticker: string, value: number, assetClassId: number | null) {
  await createAsset(h.db, ticker, {
    hasPosition: true,
    quantity: 1,
    avgPrice: value,
    avgPriceBrl: value,
    totalCost: value,
    totalCostBrl: value,
    assetClassId,
  })
  await createPriceHistory(h.db, ticker, today(), value)
}

describe('rotas de alocação', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness()
  })

  afterAll(async () => {
    await h.close()
  })

  beforeEach(async () => {
    await clearAllData(h.db)
  })

  describe('GET /allocation/', () => {
    it('responde 200', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/allocation/' })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
    })

    it('sem classe e sem posição mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/allocation/' })

      expect(res.body).toContain('Nenhuma classe cadastrada')
    })

    it('mostra classe, meta e os ativos dentro dela', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { targetPercent: 40 })
      await position(h, 'PETR4', 1000, acoes.id)

      const res = await h.app.inject({ method: 'GET', url: '/allocation/' })

      expect(res.body).toContain('Ações')
      expect(res.body).toContain('PETR4')
      expect(res.body).toContain('R$ 1.000,00')
    })

    it('lista quem está abaixo da meta antes de quem passou dela', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { targetPercent: 40 })
      const fii = await createAssetClass(h.db, 'Fii', { targetPercent: 30 })
      // Ações 80% (40 p.p. acima), Fii 20% (10 p.p. abaixo) — o aporte vai para Fii.
      await position(h, 'PETR4', 800, acoes.id)
      await position(h, 'HGLG11', 200, fii.id)

      const res = await h.app.inject({ method: 'GET', url: '/allocation/' })

      expect(res.body.indexOf('Fii')).toBeLessThan(res.body.indexOf('Ações'))
    })

    it('avisa quando as metas não somam 100%', async () => {
      await createAssetClass(h.db, 'Ações', { targetPercent: 40 })

      const res = await h.app.inject({ method: 'GET', url: '/allocation/' })

      expect(res.body).toContain('não')
      expect(res.body).toContain('100%')
    })

    it('ativo sem classe aparece no balde "Sem classe"', async () => {
      await position(h, 'BTC', 500, null)

      const res = await h.app.inject({ method: 'GET', url: '/allocation/' })

      expect(res.body).toContain('Sem classe')
      expect(res.body).toContain('BTC')
    })

    it('posição sem cotação fica de fora, mas avisa em vez de sumir', async () => {
      // O CSV do Tesouro fora do ar é justamente o caso que faz a posição ficar sem preço.
      server.use(http.get(TESOURO_CSV, () => new HttpResponse(null, { status: 503 })))
      const rendaFixa = await createAssetClass(h.db, 'Renda Fixa', { targetPercent: 50 })
      await position(h, 'PETR4', 1000, null)
      // Sem price_history: o portfólio não acha preço e o valor de mercado fica null.
      await createAsset(h.db, 'TD:IPCA2035', {
        type: 'TESOURO_DIRETO',
        hasPosition: true,
        quantity: 96.48,
        assetClassId: rendaFixa.id,
      })

      const res = await h.app.inject({ method: 'GET', url: '/allocation/' })

      expect(res.body).toContain('ficou de fora por falta de cotação')
      expect(res.body).toContain('TD:IPCA2035')
    })

    it('posição encerrada não entra na alocação', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { targetPercent: 100 })
      await createAsset(h.db, 'MGLU3', {
        hasPosition: false,
        realizedPnl: 500,
        realizedPnlBrl: 500,
        assetClassId: acoes.id,
      })

      const res = await h.app.inject({ method: 'GET', url: '/allocation/api' })
      const allocation = res.json<Allocation>()

      expect(allocation.totalValue).toBe(0)
      expect(allocation.classes[0]?.assets).toEqual([])
    })
  })

  describe('POST /allocation/classes/new', () => {
    it('cria e redireciona', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/allocation/classes/new',
        payload: { name: 'Internacional', target_percent: '25', color: '#66bb6a' },
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/allocation/')
      const created = await h.db.assetClass.findUnique({ where: { name: 'Internacional' } })
      expect(created).toMatchObject({ targetPercent: 25, color: '#66bb6a' })
    })

    it('nome duplicado responde 409', async () => {
      await createAssetClass(h.db, 'Crypto')

      const res = await h.app.inject({
        method: 'POST',
        url: '/allocation/classes/new',
        payload: { name: 'Crypto', target_percent: '10', color: '#ff6384' },
      })

      expect(res.statusCode).toBe(409)
    })

    it('meta fora de faixa responde 400, não 500', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/allocation/classes/new',
        payload: { name: 'Ações', target_percent: '-5', color: '#36a2eb' },
      })

      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /allocation/classes/:id/edit', () => {
    it('renomeia e redireciona', async () => {
      const created = await createAssetClass(h.db, 'Acoes', { targetPercent: 10 })

      const res = await h.app.inject({
        method: 'POST',
        url: `/allocation/classes/${created.id}/edit`,
        payload: { name: 'Ações', target_percent: '40', color: '#36a2eb' },
      })

      expect(res.statusCode).toBe(302)
      expect(await h.db.assetClass.findUnique({ where: { id: created.id } })).toMatchObject({
        name: 'Ações',
        targetPercent: 40,
      })
    })
  })

  describe('POST /allocation/classes/:id/target', () => {
    it('grava a meta e devolve o bloco recalculado', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { targetPercent: 40 })
      await position(h, 'PETR4', 1000, acoes.id)

      const res = await h.app.inject({
        method: 'POST',
        url: `/allocation/classes/${acoes.id}/target`,
        payload: { target_percent: '100' },
      })

      expect(res.statusCode).toBe(200)
      // Fragmento, não página inteira.
      expect(res.body).not.toContain('<!DOCTYPE')
      expect(res.body).toContain('allocation-body')
      // 100% da carteira com meta 100% ⇒ está na meta.
      expect(res.body).toContain('na meta')
      expect(await h.db.assetClass.findUnique({ where: { id: acoes.id } })).toMatchObject({
        targetPercent: 100,
      })
    })
  })

  describe('DELETE /allocation/classes/:id', () => {
    it('apaga classe vazia e devolve o bloco', async () => {
      const created = await createAssetClass(h.db, 'Crypto')

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/allocation/classes/${created.id}`,
      })

      expect(res.statusCode).toBe(200)
      expect(await h.db.assetClass.count()).toBe(0)
    })

    it('classe com ativo responde 409 e explica o que fazer', async () => {
      const acoes = await createAssetClass(h.db, 'Ações')
      await position(h, 'PETR4', 100, acoes.id)

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/allocation/classes/${acoes.id}`,
      })

      expect(res.statusCode).toBe(409)
      expect(res.body).toContain('Mova-os antes de excluir')
      expect(await h.db.assetClass.count()).toBe(1)
    })
  })

  describe('POST /allocation/assets/:ticker/class', () => {
    it('move o ativo e recalcula a alocação na resposta', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { targetPercent: 50 })
      const fii = await createAssetClass(h.db, 'Fii', { targetPercent: 50 })
      await position(h, 'HGLG11', 1000, acoes.id)

      const res = await h.app.inject({
        method: 'POST',
        url: '/allocation/assets/HGLG11/class',
        payload: { class_id: String(fii.id) },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('allocation-body')
      const asset = await h.db.asset.findUnique({ where: { ticker: 'HGLG11' } })
      expect(asset?.assetClassId).toBe(fii.id)
    })

    it('valor vazio tira a classe e joga o ativo no balde', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { targetPercent: 100 })
      await position(h, 'PETR4', 1000, acoes.id)

      const res = await h.app.inject({
        method: 'POST',
        url: '/allocation/assets/PETR4/class',
        payload: { class_id: '' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Sem classe')
      const asset = await h.db.asset.findUnique({ where: { ticker: 'PETR4' } })
      expect(asset?.assetClassId).toBeNull()
    })

    it('ativo inexistente responde 404', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/allocation/assets/XPTO3/class',
        payload: { class_id: '' },
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /allocation/api', () => {
    it('devolve os percentuais em JSON', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { targetPercent: 40 })
      await position(h, 'PETR4', 750, acoes.id)
      await position(h, 'BTC', 250, null)

      const res = await h.app.inject({ method: 'GET', url: '/allocation/api' })
      const allocation = res.json<Allocation>()

      expect(allocation.totalValue).toBe(1000)
      expect(allocation.totalTarget).toBe(40)
      const bucket = allocation.classes.find((c) => c.name === 'Ações')
      expect(bucket).toMatchObject({ currentPercent: 75, deviation: 35, rebalanceAmount: -350 })
      expect(bucket?.assets[0]).toMatchObject({ ticker: 'PETR4', percentOfClass: 100 })
    })
  })
})
