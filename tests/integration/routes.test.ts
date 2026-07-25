import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../app-harness.js'
import { clearAllData } from '../db.js'
import { createAsset, createDividend, createPriceHistory, createTransaction } from '../factories.js'
import { server, yahooChart } from '../msw.js'

// Porte de PortfolioControllerTest, TransactionControllerTest, DividendControllerTest
// e MonthlyEvolutionControllerTest.

describe('rotas da aplicação', () => {
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

  describe('dashboard', () => {
    it('GET / redireciona para o portfólio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/portfolio/')
    })

    it('carteira vazia mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma posição encontrada')
    })

    it('mostra a posição com o valor formatado em pt-BR', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 1000, price: 10, date: '2024-01-01' })
      await h.container.assets.refreshPositionFields('PETR4')
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 15)

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.body).toContain('PETR4')
      // 15.000 com separador de milhar — o que o format.js fazia no cliente.
      expect(res.body).toContain('15.000,00')
    })

    it('GET /portfolio/api devolve o resumo', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ totalInvested: 0, positions: [] })
    })

    it('GET /portfolio/api/:ticker devolve 404 para ativo inexistente', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api/XXXX9' })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('detalhe do ativo', () => {
    it('mostra transações e proventos do ativo', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })
      await createTransaction(h.db, 'PETR4', { date: '2024-03-15' })
      await createDividend(h.db, 'PETR4', { date: '2024-04-10', totalAmount: 120 })

      const res = await h.app.inject({ method: 'GET', url: '/assets/PETR4' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Petrobras')
      expect(res.body).toContain('15/03/2024')
      expect(res.body).toContain('10/04/2024')
    })

    it('ativo inexistente dá 404', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/assets/XXXX9' })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('transações', () => {
    it('GET /transactions/ responde 200', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma transação registrada')
    })

    it('cria via formulário e redireciona', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          price: '25.50',
          fees: '10',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(302)
      expect(await h.db.transaction.count()).toBe(1)
      // A posição do ativo é recalculada junto.
      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.hasPosition).toBe(true)
    })

    it('valor total sem preço deduz o preço unitário', async () => {
      await createAsset(h.db, 'PETR4')

      await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          total_price: '2510',
          fees: '10',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      const tx = await h.db.transaction.findFirstOrThrow()
      expect(tx.price).toBeCloseTo(25, 4)
    })

    it('sem preço nem total dá 400', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(400)
    })

    it('exclui e redireciona', async () => {
      await createAsset(h.db, 'PETR4')
      const tx = await createTransaction(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'POST', url: `/transactions/${tx.id}/delete` })

      expect(res.statusCode).toBe(302)
      expect(await h.db.transaction.count()).toBe(0)
    })

    it('parse-csv devolve a etapa 1 como fragmento', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/parse-csv',
        payload: { csv: 'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain('<!DOCTYPE')
      expect(res.body).toContain('Etapa 1: Revisão de Ativos')
      expect(res.body).toContain('Existente')
    })

    it('parse-csv-step2 devolve o preview das transações', async () => {
      await createAsset(h.db, 'PETR4')

      // urlencoded de propósito: é o que o cliente manda. Com JSON o teste passava
      // enquanto o browser levava 415.
      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/parse-csv-step2',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          csv: 'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
        }).toString(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('csvPreviewTable')
      expect(res.body).toContain('Confirmar Importação')
    })

    it('batch importa e devolve a contagem', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/batch',
        payload: {
          rows: [
            {
              ticker: 'PETR4',
              date: '2024-06-01',
              type: 'BUY',
              quantity: 100,
              price: 25.5,
              fees: 0,
              broker: 'XP',
              notes: '',
              currency: 'BRL',
            },
          ],
        },
      })

      expect(res.json()).toEqual({ inserted: 1 })
      expect(await h.db.transaction.count()).toBe(1)
    })

    it('ticker-info devolve fragmento sem doctype', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })

      const res = await h.app.inject({
        method: 'GET',
        url: '/transactions/ticker-info?ticker=PETR4',
      })

      expect(res.body).toContain('já cadastrado')
      expect(res.body).not.toContain('<!DOCTYPE')
    })

    it('API JSON cria com 201 e exclui com 204', async () => {
      await createAsset(h.db, 'PETR4')

      const created = await h.app.inject({
        method: 'POST',
        url: '/transactions/api',
        payload: {
          assetId: 'PETR4',
          type: 'BUY',
          quantity: 10,
          price: 25,
          fees: 0,
          date: '2024-06-01',
        },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({ assetId: 'PETR4', quantity: 10 })

      const id = created.json().id
      const deleted = await h.app.inject({ method: 'DELETE', url: `/transactions/api/${id}` })
      expect(deleted.statusCode).toBe(204)
    })
  })

  describe('proventos', () => {
    it('GET /dividends/ responde 200', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/dividends/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhum provento registrado')
    })

    it('cria via formulário e redireciona', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/new',
        payload: {
          ticker: 'PETR4',
          type: 'DIVIDENDO',
          total_amount: '150',
          tax_withheld: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(302)
      expect(await h.db.dividend.count()).toBe(1)
    })

    it('lista mostra o valor líquido', async () => {
      await createAsset(h.db, 'PETR4')
      await createDividend(h.db, 'PETR4', { totalAmount: 100, taxWithheld: 15 })

      const res = await h.app.inject({ method: 'GET', url: '/dividends/' })
      expect(res.body).toContain('85,00')
    })

    it('parse-csv marca ativo não cadastrado', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/parse-csv',
        payload: { csv: 'XXXX9\t01/03/2026\tDIVIDENDO\t1,00\t0,00\tBRL\tXP' },
      })

      expect(res.body).toContain('Ativo não cadastrado')
      expect(res.body).not.toContain('<!DOCTYPE')
    })

    it('API JSON cria com 201', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/api',
        payload: {
          ticker: 'PETR4',
          type: 'DIVIDENDO',
          date: '2024-06-01',
          totalAmount: 150,
          taxWithheld: 0,
        },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ assetId: 'PETR4', netAmount: 150 })
    })
  })

  describe('evolução', () => {
    it('sem dados mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/evolution/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhum dado de evolução encontrado')
    })

    it('recalcular redireciona', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/evolution/recalculate' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/evolution/')
    })

    it('API devolve meses e tickers', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/evolution/api' })
      expect(res.json()).toEqual({ months: [], tickers: [] })
    })

    it('API de recalcular devolve status ok', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/evolution/api/recalculate' })
      expect(res.json()).toEqual({ status: 'ok' })
    })

    it('mostra a tabela quando há snapshots', async () => {
      await createAsset(h.db, 'PETR4')
      await h.db.monthlySnapshot.create({
        data: {
          assetId: 'PETR4',
          month: '2024-01-01',
          quantity: 10,
          avgPrice: 10,
          marketPrice: 12,
          totalCost: 100,
          marketValue: 120,
        },
      })

      const res = await h.app.inject({ method: 'GET', url: '/evolution/' })
      expect(res.body).toContain('01/2024')
      expect(res.body).toContain('PETR4')
    })
  })

  describe('risk metrics', () => {
    it('sem dados mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/risk-metrics/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma métrica calculada')
    })

    it('mostra o beta e marca o não confiável', async () => {
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      await h.db.riskMetric.create({
        data: { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.25, dataPoints: 5 },
      })

      const res = await h.app.inject({ method: 'GET', url: '/risk-metrics/' })
      expect(res.body).toContain('1,25')
      expect(res.body).toContain('⚠️')
    })
  })

  describe('atualização de cotações', () => {
    it('POST /portfolio/update-prices responde vazio', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      const res = await h.app.inject({ method: 'POST', url: '/portfolio/update-prices' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('')
    })
  })
})
