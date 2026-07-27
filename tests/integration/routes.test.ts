import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { monthLabel } from '../../src/shared/format.js'
import { today } from '../../src/shared/iso-date.js'
import { createHarness, type Harness } from '../app-harness.js'
import { clearAllData } from '../db.js'
import { createAsset, createDividend, createPriceHistory, createTransaction } from '../factories.js'
import { bcbSeries, server, yahooChart } from '../msw.js'

// Porte de PortfolioControllerTest, TransactionControllerTest, DividendControllerTest
// e MonthlyEvolutionControllerTest.

/**
 * Lê um `data-*` do bloco `#evolution-data`, que o dashboard entrega como JSON escapado
 * para o Chart.js montar no cliente.
 */
function chartAttr(html: string, attr: string): unknown {
  const match = new RegExp(`${attr}="([^"]*)"`).exec(html)
  if (match?.[1] === undefined) throw new Error(`atributo ${attr} não encontrado`)
  const json = match[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
  return JSON.parse(json)
}

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

    it('ordena as posições por tipo e depois por ticker', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))
      for (const [ticker, type] of [
        ['VALE3', 'STOCK'],
        ['HGLG11', 'REIT'],
        ['PETR4', 'STOCK'],
      ] as const) {
        await createAsset(h.db, ticker, { type })
        await createTransaction(h.db, ticker, { quantity: 10, price: 10, date: '2024-01-02' })
        await h.container.assets.refreshPositionFields(ticker)
        await createPriceHistory(h.db, ticker, '2024-06-01', 12)
      }

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      // REIT antes de STOCK; dentro do mesmo tipo, por ticker.
      expect(res.body.indexOf('HGLG11')).toBeGreaterThan(-1)
      expect(res.body.indexOf('HGLG11')).toBeLessThan(res.body.indexOf('PETR4'))
      expect(res.body.indexOf('PETR4')).toBeLessThan(res.body.indexOf('VALE3'))
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

    it('GET /portfolio/api/:ticker devolve a posição do ativo', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 20, date: '2024-01-02' })
      await h.container.assets.refreshPositionFields('PETR4')
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 25)

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api/PETR4' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ticker: 'PETR4', quantity: 100, currentPrice: 25 })
    })

    it('GET /portfolio/api/:ticker devolve 404 para ativo cadastrado sem transação', async () => {
      // 404 por outro motivo que o anterior: o ativo existe, mas não tem posição a montar.
      server.use(yahooChart('yahoo_chart_empty.json'))
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api/PETR4' })

      expect(res.statusCode).toBe(404)
    })

    it('com snapshots monta os dados do gráfico', async () => {
      server.use(
        yahooChart('yahoo_chart_empty.json'),
        bcbSeries([{ data: '01/06/2024', valor: '10,50' }]),
      )
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      await createAsset(h.db, 'HGLG11', { type: 'REIT' })
      await h.db.monthlySnapshot.createMany({
        data: [
          {
            assetId: 'PETR4',
            month: '2024-01-01',
            quantity: 10,
            avgPrice: 10,
            marketPrice: 12,
            totalCost: 100,
            marketValue: 120,
          },
          {
            assetId: 'HGLG11',
            month: '2024-01-01',
            quantity: 1,
            avgPrice: 150,
            marketPrice: 160,
            totalCost: 150,
            marketValue: 160,
          },
        ],
      })
      await h.db.benchmarkPrice.create({
        data: { ticker: 'IBOV', month: '2024-01-01', close: 130000 },
      })

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.statusCode).toBe(200)
      expect(chartAttr(res.body, 'data-labels')).toEqual(['01/2024'])
      // Uma série por tipo de ativo, somando o valor de mercado dos snapshots do mês.
      expect(chartAttr(res.body, 'data-datasets')).toEqual([
        { label: 'REIT', data: [160] },
        { label: 'STOCK', data: [120] },
      ])
      expect(chartAttr(res.body, 'data-invested')).toEqual([250])
      // As linhas de referência entram com um ponto por mês; o cálculo é testado em domain/chart.
      expect(chartAttr(res.body, 'data-ibov')).toHaveLength(1)
      expect(chartAttr(res.body, 'data-cdi')).toHaveLength(1)
    })

    it('com proventos monta o gráfico mensal por tipo de ativo', async () => {
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      await createAsset(h.db, 'HGLG11', { type: 'REIT' })
      await createDividend(h.db, 'PETR4', { date: '2024-01-10', totalAmount: 100 })
      await createDividend(h.db, 'PETR4', { date: '2024-03-10', totalAmount: 40, taxWithheld: 6 })
      await createDividend(h.db, 'HGLG11', { date: '2024-02-10', totalAmount: 80 })

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Proventos por Mês')

      // O eixo vai do primeiro provento até o mês corrente, então o tamanho depende de
      // quando o teste roda — o que dá para fixar são as pontas e os três primeiros meses.
      const labels = chartAttr(res.body, 'data-dividend-labels') as string[]
      expect(labels[0]).toBe('01/2024')
      expect(labels.at(-1)).toBe(monthLabel(today()))

      // Uma série por tipo de ativo, com o líquido do mês e zero onde não houve provento.
      const datasets = chartAttr(res.body, 'data-dividend-datasets') as Array<{
        label: string
        data: number[]
      }>
      expect(datasets.map((d) => d.label)).toEqual(['REIT', 'STOCK'])
      expect(datasets[0]?.data.slice(0, 3)).toEqual([0, 80, 0])
      expect(datasets[1]?.data.slice(0, 3)).toEqual([100, 0, 34])
      for (const dataset of datasets) expect(dataset.data).toHaveLength(labels.length)
      expect(chartAttr(res.body, 'data-dividend-moving-average')).toHaveLength(labels.length)
    })

    it('a média móvel acompanha as séries', async () => {
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      await createDividend(h.db, 'PETR4', { date: today(), totalAmount: 300, taxWithheld: 45 })

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      // Com um mês só no eixo, a média é o próprio líquido do mês.
      expect(chartAttr(res.body, 'data-dividend-labels')).toEqual([monthLabel(today())])
      expect(chartAttr(res.body, 'data-dividend-moving-average')).toEqual([255])
    })

    it('sem proventos não desenha o gráfico mensal', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain('Proventos por Mês')
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

    it('com posição aberta mostra os cartões de posição', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 20, date: '2024-01-02' })
      // Sem isso o ativo fica com `hasPosition = false` e os cartões nem renderizam.
      await h.container.assets.refreshPositionFields('PETR4')
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 25)

      const res = await h.app.inject({ method: 'GET', url: '/assets/PETR4' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Preço Médio')
      expect(res.body).toContain('20,00')
      expect(res.body).toContain('25,00')
    })
  })

  describe('transações', () => {
    it('GET /transactions/ responde 200', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma transação registrada')
    })

    it('a lista renderiza a linha da transação', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })
      await createTransaction(h.db, 'PETR4', {
        quantity: 100,
        price: 25.5,
        fees: 10,
        date: '2024-06-01',
        broker: 'XP',
      })

      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })

      expect(res.body).toContain('01/06/2024')
      expect(res.body).toContain('25,50')
      expect(res.body).toContain('XP')
      // 100 × 25,50 + 10 de taxas.
      expect(res.body).toContain('2.560,00')
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

    it('edita e volta para a origem informada', async () => {
      await createAsset(h.db, 'PETR4')
      const dividend = await createDividend(h.db, 'PETR4', { totalAmount: 100, taxWithheld: 0 })

      const res = await h.app.inject({
        method: 'POST',
        url: `/dividends/${dividend.id}/edit`,
        payload: {
          type: 'JCP',
          total_amount: '200',
          tax_withheld: '30',
          date: '2024-07-01',
          currency: 'BRL',
          returnTo: '/assets/PETR4',
        },
      })

      expect(res.statusCode).toBe(302)
      // O provento é editado tanto pela lista quanto pelo detalhe do ativo — o formulário
      // diz para onde voltar.
      expect(res.headers.location).toBe('/assets/PETR4')

      const updated = await h.db.dividend.findUniqueOrThrow({ where: { id: dividend.id } })
      expect(updated).toMatchObject({ type: 'JCP', totalAmount: 200, taxWithheld: 30 })
    })

    it('exclui e volta para a lista quando não há origem', async () => {
      await createAsset(h.db, 'PETR4')
      const dividend = await createDividend(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'POST', url: `/dividends/${dividend.id}/delete` })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/dividends/')
      expect(await h.db.dividend.count()).toBe(0)
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
