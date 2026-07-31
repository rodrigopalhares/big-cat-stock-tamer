import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../../../tests/app-harness.js'
import { clearAllData } from '../../../tests/db.js'
import { createAsset, createAssetClass, createTransaction } from '../../../tests/factories.js'
import { server, tesouroCsv, yahooChart } from '../../../tests/msw.js'

// Porte de src/test/kotlin/com/stocks/controller/AssetControllerTest.kt

describe('rotas de ativos', () => {
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

  describe('GET /assets/', () => {
    it('responde 200', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/assets/' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
    })

    it('lista vazia mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/assets/' })
      expect(res.body).toContain('Nenhum ativo cadastrado ainda')
    })

    it('mostra os ativos cadastrados', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })

      const res = await h.app.inject({ method: 'GET', url: '/assets/' })
      expect(res.body).toContain('PETR4')
      expect(res.body).toContain('Petrobras')
    })

    it('aplica o filtro de tipo', async () => {
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      await createAsset(h.db, 'HGLG11', { type: 'REIT' })

      const res = await h.app.inject({ method: 'GET', url: '/assets/?type=REIT' })
      expect(res.body).toContain('HGLG11')
      expect(res.body).not.toContain('>PETR4<')
    })
  })

  describe('POST /assets/new', () => {
    it('cria e redireciona', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/assets/new',
        payload: { ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' },
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/assets/')
      expect(await h.db.asset.findUnique({ where: { ticker: 'PETR4' } })).not.toBeNull()
    })

    it('duplicado permanece na página com o aviso', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })

      const res = await h.app.inject({
        method: 'POST',
        url: '/assets/new',
        payload: { ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('já cadastrado')
    })

    it('sem nome, busca os dados no Yahoo', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      await h.app.inject({
        method: 'POST',
        url: '/assets/new',
        payload: { ticker: 'PETR3', name: '', type: '', currency: '' },
      })

      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR3' } })
      expect(asset.name).toContain('Petrobras')
    })

    it('código do Tesouro é resolvido pelo CSV, não pelo Yahoo', async () => {
      server.use(tesouroCsv('tesouro_direto_short_codes.csv'))

      await h.app.inject({
        method: 'POST',
        url: '/assets/new',
        payload: { ticker: 'TD:IPCA2026', name: '', type: '', currency: '' },
      })

      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'TD:IPCA2026' } })
      expect(asset.name).toBe('Tesouro IPCA+ 15/08/2026')
      expect(asset.type).toBe('TESOURO_DIRETO')
      expect(asset.currency).toBe('BRL')
      // O código longo do CSV mora aqui: é ele que vai buscar a cotação.
      expect(asset.yfTicker).toBe('Tesouro IPCA+;15/08/2026')
    })
  })

  describe('GET /assets/:ticker', () => {
    it('traz o modal de edição preenchido, sem passar pela lista', async () => {
      const fii = await createAssetClass(h.db, 'Fii')
      await createAsset(h.db, 'HGLG11', { name: 'CSHG Logística', assetClassId: fii.id })

      const res = await h.app.inject({ method: 'GET', url: '/assets/HGLG11' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('editAssetModal')
      expect(res.body).toContain('data-edit-asset')
      expect(res.body).toContain(`data-asset-class-id="${fii.id}"`)
      // Volta para o detalhe, não para /assets/.
      expect(res.body).toContain('data-return-to="/assets/HGLG11"')
      // O select traz as classes cadastradas.
      expect(res.body).toContain('asset_class_id')
    })
  })

  describe('POST /assets/:ticker/edit', () => {
    it('atualiza e redireciona', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/assets/PETR4/edit',
        payload: { name: 'Petrobras PN', type: 'STOCK', yf_ticker: 'PETR4.SA', currency: 'BRL' },
      })

      expect(res.statusCode).toBe(302)
      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.name).toBe('Petrobras PN')
      expect(asset.yfTicker).toBe('PETR4.SA')
    })

    it('checkbox marcado vira deslistado', async () => {
      await createAsset(h.db, 'PETR4')

      await h.app.inject({
        method: 'POST',
        url: '/assets/PETR4/edit',
        payload: { name: 'x', type: 'STOCK', yf_ticker: '', currency: 'BRL', delisted: 'on' },
      })

      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.delisted).toBe(true)
    })

    it('troca a classe de alocação', async () => {
      const fii = await createAssetClass(h.db, 'Fii')
      await createAsset(h.db, 'HGLG11')

      await h.app.inject({
        method: 'POST',
        url: '/assets/HGLG11/edit',
        payload: {
          name: '',
          type: 'REIT',
          yf_ticker: '',
          currency: 'BRL',
          asset_class_id: String(fii.id),
        },
      })

      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'HGLG11' } })
      expect(asset.assetClassId).toBe(fii.id)
    })

    it('classe em branco tira a classe do ativo', async () => {
      const fii = await createAssetClass(h.db, 'Fii')
      await createAsset(h.db, 'HGLG11', { assetClassId: fii.id })

      await h.app.inject({
        method: 'POST',
        url: '/assets/HGLG11/edit',
        payload: { name: '', type: 'REIT', yf_ticker: '', currency: 'BRL', asset_class_id: '' },
      })

      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'HGLG11' } })
      expect(asset.assetClassId).toBeNull()
    })

    it('classe inexistente responde 404 em vez de erro de FK', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/assets/PETR4/edit',
        payload: { name: '', type: 'STOCK', yf_ticker: '', currency: 'BRL', asset_class_id: '999' },
      })

      expect(res.statusCode).toBe(404)
    })

    it('respeita returnTo', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/assets/PETR4/edit',
        payload: {
          name: 'x',
          type: 'STOCK',
          yf_ticker: '',
          currency: 'BRL',
          returnTo: '/assets/PETR4',
        },
      })

      expect(res.headers.location).toBe('/assets/PETR4')
    })
  })

  describe('POST /assets/:ticker/delete', () => {
    it('apaga em cascata e redireciona', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'POST', url: '/assets/PETR4/delete' })

      expect(res.statusCode).toBe(302)
      expect(await h.db.asset.count()).toBe(0)
      expect(await h.db.transaction.count()).toBe(0)
    })
  })

  describe('GET /assets/ticker-info', () => {
    it('ticker curto devolve vazio sem consultar nada', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/assets/ticker-info?ticker=AB' })
      expect(res.body).toBe('')
    })

    it('ticker cadastrado avisa que já existe', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/assets/ticker-info?ticker=petr4' })
      expect(res.body).toContain('já cadastrado')
      expect(res.body).not.toContain('<!DOCTYPE')
    })

    it('ticker novo devolve o preview e os campos via swap OOB', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      const res = await h.app.inject({ method: 'GET', url: '/assets/ticker-info?ticker=PETR3' })

      expect(res.body).toContain('Petrobras')
      expect(res.body).toContain('hx-swap-oob="true"')
      expect(res.body).toContain('id="assetYfTicker"')
    })

    it('código do Tesouro preenche o título e o vencimento', async () => {
      server.use(tesouroCsv('tesouro_direto_short_codes.csv'))

      const res = await h.app.inject({
        method: 'GET',
        url: '/assets/ticker-info?ticker=TD:IPCA2026',
      })

      expect(res.body).toContain('Tesouro IPCA+ 15/08/2026')
      expect(res.body).toContain('TESOURO_DIRETO')
    })

    it('avisa quando o ano tem mais de um vencimento', async () => {
      server.use(tesouroCsv('tesouro_direto_short_codes.csv'))

      const res = await h.app.inject({
        method: 'GET',
        url: '/assets/ticker-info?ticker=TD:PRE2009',
      })

      expect(res.body).toContain('mais de um vencimento')
      expect(res.body).toContain('01/07/2009')
    })
  })

  describe('API JSON', () => {
    it('GET /assets/api lista', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/assets/api' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(1)
    })

    it('POST /assets/api cria com 201', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/assets/api',
        payload: { ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ ticker: 'PETR4' })
    })

    it('POST /assets/api duplicado dá 409', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/assets/api',
        payload: { ticker: 'PETR4', currency: 'BRL' },
      })

      expect(res.statusCode).toBe(409)
    })

    it('GET /assets/api/:ticker devolve 404 quando não existe', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/assets/api/XXXX9' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'Asset not found' })
    })
  })
})
