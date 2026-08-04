import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset, createPriceHistory, createTransaction } from '../../../tests/factories.js'
import {
  bcbSeries,
  HttpResponse,
  http,
  server,
  YAHOO_CHART,
  yahooChart,
} from '../../../tests/msw.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { BenchmarkService, IBOV_TICKER } from './benchmark.service.js'
import { RiskMetricsService } from './risk-metrics.service.js'

const TODAY = isoDate('2024-06-30')

describe('risk', () => {
  let db: TestDb
  let benchmarks: BenchmarkService
  let service: RiskMetricsService

  beforeAll(async () => {
    db = await createTestDb()
    benchmarks = new BenchmarkService(db, new YahooClient(), new BcbClient())
    service = new RiskMetricsService(db, benchmarks)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  /** Doze meses de preços mensais, para haver pontos suficientes na regressão. */
  async function seedMonthlySeries(ticker: string, base: number, step: number) {
    for (let month = 1; month <= 12; month++) {
      const date = `2023-${String(month).padStart(2, '0')}-28`
      await createPriceHistory(db, ticker, date, base + step * month)
    }
  }

  async function seedIbov(base: number, step: number) {
    for (let month = 1; month <= 12; month++) {
      await db.benchmarkPrice.create({
        data: {
          ticker: IBOV_TICKER,
          month: `2023-${String(month).padStart(2, '0')}-01`,
          close: base + step * month,
        },
      })
    }
  }

  describe('BenchmarkService', () => {
    it('grava o último preço de cada mês do IBOV', async () => {
      server.use(yahooChart('yahoo_chart_historical.json'))

      await benchmarks.fetchAndStoreIbovMonthly(TODAY)

      expect(await benchmarks.hasData()).toBe(true)
    })

    it('Yahoo sem dados não grava nada', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      await benchmarks.fetchAndStoreIbovMonthly(TODAY)

      expect(await benchmarks.hasData()).toBe(false)
    })

    it('getMonthlyPrices devolve ordenado por mês', async () => {
      await seedIbov(100, 5)

      const prices = await benchmarks.getMonthlyPrices()
      expect(prices).toHaveLength(12)
      expect(prices[0]?.[0]).toBe('2023-01-01')
    })

    it('clearBenchmarkData apaga a série', async () => {
      await seedIbov(100, 5)
      await benchmarks.clearBenchmarkData()

      expect(await benchmarks.hasData()).toBe(false)
    })

    it('fetchCdiAnnualRate delega ao BCB', async () => {
      server.use(bcbSeries([{ data: '01/06/2024', valor: '10,50' }]))

      expect(await benchmarks.fetchCdiAnnualRate()).toBeCloseTo(0.105, 6)
    })
  })

  describe('RiskMetricsService.recalculate', () => {
    beforeEach(() => {
      server.use(
        bcbSeries([{ data: '01/06/2024', valor: '10,00' }]),
        http.get(YAHOO_CHART, () => HttpResponse.json({ chart: { result: [] } })),
      )
    })

    it('sem dados do IBOV não grava métrica', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4')

      await service.recalculate(TODAY)

      expect(await db.riskMetric.count()).toBe(0)
    })

    it('calcula beta para ativo com série suficiente', async () => {
      await seedIbov(100, 5)
      await createAsset(db, 'PETR4', { type: 'STOCK' })
      await createTransaction(db, 'PETR4')
      await seedMonthlySeries('PETR4', 20, 2)

      await service.recalculate(TODAY)

      const metric = await db.riskMetric.findFirst({ where: { ticker: 'PETR4' } })
      expect(metric).not.toBeNull()
      expect(metric?.beta).not.toBeNull()
      expect(metric?.dataPoints).toBeGreaterThanOrEqual(2)
    })

    it('ativo sem histórico registra métrica vazia', async () => {
      await seedIbov(100, 5)
      await createAsset(db, 'PETR4', { type: 'STOCK' })
      await createTransaction(db, 'PETR4')

      await service.recalculate(TODAY)

      const metric = await db.riskMetric.findFirst({ where: { ticker: 'PETR4' } })
      expect(metric?.beta).toBeNull()
      expect(metric?.dataPoints).toBe(0)
    })

    it('ignora tipos fora de ação e FII', async () => {
      await seedIbov(100, 5)
      await createAsset(db, 'BOVA11', { type: 'ETF' })
      await createTransaction(db, 'BOVA11')

      await service.recalculate(TODAY)

      expect(await db.riskMetric.count()).toBe(0)
    })

    it('ignora ativo sem transação', async () => {
      await seedIbov(100, 5)
      await createAsset(db, 'PETR4', { type: 'STOCK' })

      await service.recalculate(TODAY)

      expect(await db.riskMetric.count()).toBe(0)
    })

    it('rodar duas vezes no mesmo dia não duplica', async () => {
      await seedIbov(100, 5)
      await createAsset(db, 'PETR4', { type: 'STOCK' })
      await createTransaction(db, 'PETR4')
      await seedMonthlySeries('PETR4', 20, 2)

      await service.recalculate(TODAY)
      await service.recalculate(TODAY)

      expect(await db.riskMetric.count()).toBe(1)
    })
  })

  describe('RiskMetricsService.getSummary', () => {
    /** PETR4 com posição aberta (valendo 100) e VALE3 já vendido, ambos com métrica. */
    async function seedTwoStocks() {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createAsset(db, 'VALE3', { type: 'STOCK', hasPosition: false, quantity: 0 })
      await createPriceHistory(db, 'PETR4', '2024-06-01', 10)
      await createPriceHistory(db, 'VALE3', '2024-06-01', 30)
      await db.riskMetric.createMany({
        data: [
          { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.0, dataPoints: 12 },
          { ticker: 'VALE3', calculatedAt: '2024-06-30', beta: 2.0, dataPoints: 12 },
        ],
      })
    }

    it('sem métricas devolve resumo vazio', async () => {
      expect(await service.getSummary()).toEqual({
        metrics: [],
        portfolioBeta: null,
        cdiAnnual: null,
        calculatedAt: null,
      })
    })

    it('marca como não confiável quando há poucos pontos', async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK' })
      await db.riskMetric.create({
        data: { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.2, dataPoints: 5 },
      })

      const summary = await service.getSummary('all')
      expect(summary.metrics[0]?.reliable).toBe(false)
    })

    it('marca como confiável a partir de 12 pontos', async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK' })
      await db.riskMetric.create({
        data: { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.2, dataPoints: 12 },
      })

      expect((await service.getSummary('all')).metrics[0]?.reliable).toBe(true)
    })

    it('usa só a rodada mais recente', async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK' })
      await db.riskMetric.createMany({
        data: [
          { ticker: 'PETR4', calculatedAt: '2024-05-30', beta: 0.5, dataPoints: 12 },
          { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.5, dataPoints: 12 },
        ],
      })

      const summary = await service.getSummary('all')
      expect(summary.calculatedAt).toBe('2024-06-30')
      expect(summary.metrics).toHaveLength(1)
      expect(summary.metrics[0]?.beta).toBe(1.5)
    })

    it('beta da carteira é ponderado pelo valor das posições', async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createAsset(db, 'VALE3', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createPriceHistory(db, 'PETR4', '2024-06-01', 10)
      await createPriceHistory(db, 'VALE3', '2024-06-01', 30)
      await db.riskMetric.createMany({
        data: [
          { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.0, dataPoints: 12 },
          { ticker: 'VALE3', calculatedAt: '2024-06-30', beta: 2.0, dataPoints: 12 },
        ],
      })

      // Pesos 100 e 300 sobre 400 ⇒ 0,25×1 + 0,75×2 = 1,75
      expect((await service.getSummary()).portfolioBeta).toBeCloseTo(1.75, 3)
    })

    it('por padrão lista só quem tem posição aberta', async () => {
      await seedTwoStocks()

      const summary = await service.getSummary()
      expect(summary.metrics.map((m) => m.ticker)).toEqual(['PETR4'])
    })

    it("'all' inclui quem já foi vendido", async () => {
      await seedTwoStocks()

      const summary = await service.getSummary('all')
      expect(summary.metrics.map((m) => m.ticker)).toEqual(['PETR4', 'VALE3'])
      expect(summary.metrics[1]?.hasPosition).toBe(false)
    })

    it('esconde ativo sem regressão nos dois filtros', async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createPriceHistory(db, 'PETR4', '2024-06-01', 10)
      await db.riskMetric.create({
        data: { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: null, dataPoints: 0 },
      })

      expect((await service.getSummary()).metrics).toEqual([])
      expect((await service.getSummary('all')).metrics).toEqual([])
    })

    it('% do tipo é a fatia da posição dentro do próprio tipo', async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createAsset(db, 'VALE3', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createAsset(db, 'HGLG11', { type: 'REIT', hasPosition: true, quantity: 10 })
      await createPriceHistory(db, 'PETR4', '2024-06-01', 10)
      await createPriceHistory(db, 'VALE3', '2024-06-01', 30)
      await createPriceHistory(db, 'HGLG11', '2024-06-01', 50)
      await db.riskMetric.createMany({
        data: ['PETR4', 'VALE3', 'HGLG11'].map((ticker) => ({
          ticker,
          calculatedAt: '2024-06-30',
          beta: 1.0,
          dataPoints: 12,
        })),
      })

      const byTicker = new Map(
        (await service.getSummary()).metrics.map((m) => [m.ticker, m.typeShare]),
      )
      // STOCK: 100 e 300 sobre 400. REIT: 500 sozinho.
      expect(byTicker.get('PETR4')).toBeCloseTo(0.25, 6)
      expect(byTicker.get('VALE3')).toBeCloseTo(0.75, 6)
      expect(byTicker.get('HGLG11')).toBeCloseTo(1, 6)
    })

    it('% do tipo não muda com o filtro — quem não tem posição vale zero', async () => {
      await seedTwoStocks()
      await db.riskMetric.create({
        data: { ticker: 'ITUB4', calculatedAt: '2024-06-30', beta: 1.0, dataPoints: 12 },
      })
      await createAsset(db, 'ITUB4', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createPriceHistory(db, 'ITUB4', '2024-06-01', 30)

      const withPosition = await service.getSummary()
      const all = await service.getSummary('all')

      // PETR4 vale 100 e ITUB4 300; VALE3 está vendido e não entra no denominador.
      expect(withPosition.metrics.find((m) => m.ticker === 'PETR4')?.typeShare).toBeCloseTo(0.25, 6)
      expect(all.metrics.find((m) => m.ticker === 'PETR4')?.typeShare).toBeCloseTo(0.25, 6)
      expect(all.metrics.find((m) => m.ticker === 'VALE3')?.typeShare).toBe(0)
    })

    it('sem valor de mercado o beta da carteira é nulo', async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: false })
      await db.riskMetric.create({
        data: { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.0, dataPoints: 12 },
      })

      expect((await service.getSummary()).portfolioBeta).toBeNull()
    })
  })
})
