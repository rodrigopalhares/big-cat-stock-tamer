import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import {
  createAsset,
  createDividend,
  createExchangeRate,
  createPriceHistory,
  createTransaction,
} from '../../../tests/factories.js'
import { server, yahooChart } from '../../../tests/msw.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { TesouroClient } from '../../integrations/tesouro/tesouro.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { AssetService } from '../asset/asset.service.js'
import { DividendService } from '../dividend/dividend.service.js'
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import { PriceHistoryService } from '../price-history/price-history.service.js'
import { TransactionService } from '../transaction/transaction.service.js'
import { PortfolioService } from './portfolio.service.js'

const TODAY = isoDate('2024-06-30')

describe('PortfolioService', () => {
  let db: TestDb
  let service: PortfolioService
  let assets: AssetService

  beforeAll(async () => {
    db = await createTestDb()
    const yahoo = new YahooClient()
    const tesouro = new TesouroClient()
    const exchangeRates = new ExchangeRateService(db, new BcbClient())
    const transactions = new TransactionService(db, yahoo, exchangeRates)
    const dividends = new DividendService(db, transactions, exchangeRates)
    const priceHistory = new PriceHistoryService(db, yahoo, tesouro)
    assets = new AssetService(db)
    service = new PortfolioService(db, yahoo, tesouro, priceHistory, dividends, exchangeRates)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  /** Cria um ativo com transações e já recalcula os campos de posição. */
  async function seedPosition(ticker: string, overrides: Record<string, unknown> = {}) {
    await createAsset(db, ticker, overrides)
    await createTransaction(db, ticker, { quantity: 10, price: 10, date: '2024-01-01' })
    await assets.refreshPositionFields(ticker)
  }

  describe('buildPositions', () => {
    it('ativo sem posição e sem resultado realizado é omitido', async () => {
      await createAsset(db, 'PETR4')

      const all = await db.asset.findMany()
      expect(await service.buildPositions(all, false, TODAY)).toEqual([])
    })

    it('calcula valor e resultado não realizado a partir do último preço', async () => {
      await seedPosition('PETR4')
      await createPriceHistory(db, 'PETR4', '2024-06-01', 15)

      const [position] = await service.buildPositions(await db.asset.findMany(), false, TODAY)

      expect(position?.quantity).toBeCloseTo(10, 3)
      expect(position?.avgPrice).toBeCloseTo(10, 3)
      expect(position?.currentPrice).toBe(15)
      expect(position?.currentValue).toBeCloseTo(150, 3)
      expect(position?.unrealizedPnl).toBeCloseTo(50, 3)
    })

    it('sem preço, valor e resultado não realizado ficam nulos', async () => {
      await seedPosition('PETR4')

      const [position] = await service.buildPositions(await db.asset.findMany(), false, TODAY)

      expect(position?.currentPrice).toBeNull()
      expect(position?.currentValue).toBeNull()
      expect(position?.unrealizedPnl).toBeNull()
    })

    it('inclui o resultado de proventos', async () => {
      await seedPosition('PETR4')
      await createDividend(db, 'PETR4', { totalAmount: 100, taxWithheld: 15 })

      const [position] = await service.buildPositions(await db.asset.findMany(), false, TODAY)

      expect(position?.dividendPnl).toBeCloseTo(85, 3)
    })

    it('converte para reais o ativo em moeda estrangeira', async () => {
      await createAsset(db, 'AAPL', { currency: 'USD' })
      await createTransaction(db, 'AAPL', { quantity: 10, price: 100, date: '2024-01-01' })
      await assets.refreshPositionFields('AAPL')
      await createPriceHistory(db, 'AAPL', '2024-06-01', 150)
      await createExchangeRate(db, '2024-06-30', 5)

      const [position] = await service.buildPositions(await db.asset.findMany(), false, TODAY)

      expect(position?.exchangeRate).toBeCloseTo(5, 3)
      expect(position?.currentValue).toBeCloseTo(1500, 3)
      expect(position?.currentValueBrl).toBeCloseTo(7500, 3)
    })

    it('ativo em reais não tem taxa de câmbio', async () => {
      await seedPosition('PETR4')
      await createPriceHistory(db, 'PETR4', '2024-06-01', 15)

      const [position] = await service.buildPositions(await db.asset.findMany(), false, TODAY)

      expect(position?.exchangeRate).toBeNull()
      expect(position?.currentValueBrl).toBe(position?.currentValue)
    })

    it('posição encerrada com lucro ainda aparece', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-01' })
      await createTransaction(db, 'PETR4', {
        type: 'SELL',
        quantity: -10,
        price: 15,
        date: '2024-02-01',
      })
      await assets.refreshPositionFields('PETR4')

      const [position] = await service.buildPositions(await db.asset.findMany(), false, TODAY)

      expect(position?.ticker).toBe('PETR4')
      expect(position?.realizedPnl).toBeCloseTo(50, 3)
      expect(position?.currentValue).toBeNull()
    })

    it('calcula XIRR e o equivalente mensal', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 100, date: '2023-06-30' })
      await assets.refreshPositionFields('PETR4')
      await createPriceHistory(db, 'PETR4', '2024-06-29', 120)

      const [position] = await service.buildPositions(await db.asset.findMany(), false, TODAY)

      expect(position?.irrAnnual).not.toBeNull()
      expect(position?.irrMonthly).not.toBeNull()
      expect(position?.irrAnnual as number).toBeGreaterThan(0)
    })

    it('com fetchQuotes usa o preço do banco quando já existe o de hoje', async () => {
      await seedPosition('PETR4', { yfTicker: 'PETR4.SA' })
      await createPriceHistory(db, 'PETR4', TODAY, 42)

      // Sem handler do Yahoo: se chamasse a API, o teste falharia.
      const [position] = await service.buildPositions(await db.asset.findMany(), true, TODAY)

      expect(position?.currentPrice).toBe(42)
    })

    it('com fetchQuotes busca no Yahoo o que falta e grava o resultado', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))
      await seedPosition('PETR3', { yfTicker: 'PETR3.SA' })

      const [position] = await service.buildPositions(await db.asset.findMany(), true, TODAY)

      expect(position?.currentPrice).toBeCloseTo(38.45, 2)
      const stored = await db.priceHistory.findFirst({ where: { assetId: 'PETR3', date: TODAY } })
      expect(stored?.close).toBeCloseTo(38.45, 2)
    })

    it('ativo deslistado não é consultado na API', async () => {
      await seedPosition('OIBR3', { delisted: true })
      await createPriceHistory(db, 'OIBR3', '2024-06-01', 1)

      const [position] = await service.buildPositions(await db.asset.findMany(), true, TODAY)

      expect(position?.currentPrice).toBe(1)
      expect(position?.delisted).toBe(true)
    })

    it('tipo sem cotação usa apenas o histórico', async () => {
      await seedPosition('CDB1', { type: 'RENDA_FIXA' })
      await createPriceHistory(db, 'CDB1', '2024-06-01', 100)

      const [position] = await service.buildPositions(await db.asset.findMany(), true, TODAY)

      expect(position?.currentPrice).toBe(100)
    })
  })

  describe('aggregatePositions', () => {
    it('soma os totais da carteira', async () => {
      await seedPosition('PETR4')
      await seedPosition('VALE3')
      await createPriceHistory(db, 'PETR4', '2024-06-01', 15)
      await createPriceHistory(db, 'VALE3', '2024-06-01', 20)

      const positions = await service.buildPositions(await db.asset.findMany(), false, TODAY)
      const summary = service.aggregatePositions(positions, TODAY)

      expect(summary.totalInvested).toBeCloseTo(200, 3)
      expect(summary.currentValue).toBeCloseTo(350, 3)
      expect(summary.unrealizedPnl).toBeCloseTo(150, 3)
      expect(summary.positions).toHaveLength(2)
    })

    it('sem posições devolve valores nulos', () => {
      const summary = service.aggregatePositions([], TODAY)

      expect(summary.totalInvested).toBe(0)
      expect(summary.currentValue).toBeNull()
      expect(summary.unrealizedPnl).toBeNull()
      expect(summary.irrAnnual).toBeNull()
    })

    it('soma o resultado de proventos', async () => {
      await seedPosition('PETR4')
      await createDividend(db, 'PETR4', { totalAmount: 100, taxWithheld: 0 })

      const positions = await service.buildPositions(await db.asset.findMany(), false, TODAY)
      expect(service.aggregatePositions(positions, TODAY).dividendPnl).toBeCloseTo(100, 3)
    })
  })
})
