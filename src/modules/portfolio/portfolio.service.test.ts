import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import {
  createAsset,
  createDividend,
  createExchangeRate,
  createPriceHistory,
  createTransaction,
} from '../../../tests/factories.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { TesouroClient } from '../../integrations/tesouro/tesouro.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { AssetClassService } from '../allocation/asset-class.service.js'
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
    const assetClasses = new AssetClassService(db)
    const transactions = new TransactionService(db, yahoo, exchangeRates, assetClasses)
    const dividends = new DividendService(db, transactions, exchangeRates)
    const priceHistory = new PriceHistoryService(db, yahoo, tesouro)
    assets = new AssetService(db, assetClasses, priceHistory)
    service = new PortfolioService(db, priceHistory, dividends, exchangeRates)
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
      expect(await service.buildPositions(all, TODAY)).toEqual([])
    })

    it('calcula valor e resultado não realizado a partir do último preço', async () => {
      await seedPosition('PETR4')
      await createPriceHistory(db, 'PETR4', '2024-06-01', 15)

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.quantity).toBeCloseTo(10, 3)
      expect(position?.avgPrice).toBeCloseTo(10, 3)
      expect(position?.currentPrice).toBe(15)
      expect(position?.currentValue).toBeCloseTo(150, 3)
      expect(position?.unrealizedPnl).toBeCloseTo(50, 3)
    })

    it('sem preço, valor e resultado não realizado ficam nulos', async () => {
      await seedPosition('PETR4')

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.currentPrice).toBeNull()
      expect(position?.currentValue).toBeNull()
      expect(position?.unrealizedPnl).toBeNull()
    })

    it('inclui o resultado de proventos', async () => {
      await seedPosition('PETR4')
      await createDividend(db, 'PETR4', { totalAmount: 100, taxWithheld: 15 })

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.dividendPnl).toBeCloseTo(85, 3)
    })

    it('converte para reais o ativo em moeda estrangeira', async () => {
      await createAsset(db, 'AAPL', { currency: 'USD' })
      await createTransaction(db, 'AAPL', { quantity: 10, price: 100, date: '2024-01-01' })
      await assets.refreshPositionFields('AAPL')
      await createPriceHistory(db, 'AAPL', '2024-06-01', 150)
      await createExchangeRate(db, '2024-06-30', 5)

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.exchangeRate).toBeCloseTo(5, 3)
      expect(position?.currentValue).toBeCloseTo(1500, 3)
      expect(position?.currentValueBrl).toBeCloseTo(7500, 3)
    })

    it('ativo em reais não tem taxa de câmbio', async () => {
      await seedPosition('PETR4')
      await createPriceHistory(db, 'PETR4', '2024-06-01', 15)

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

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

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.ticker).toBe('PETR4')
      expect(position?.realizedPnl).toBeCloseTo(50, 3)
      expect(position?.currentValue).toBeNull()
    })

    it('calcula XIRR e o equivalente mensal', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 100, date: '2023-06-30' })
      await assets.refreshPositionFields('PETR4')
      await createPriceHistory(db, 'PETR4', '2024-06-29', 120)

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.irrAnnual).not.toBeNull()
      expect(position?.irrMonthly).not.toBeNull()
      expect(position?.irrAnnual as number).toBeGreaterThan(0)
    })

    it('usa o último preço gravado sem consultar a API, e diz de quando ele é', async () => {
      // Sem handler do Yahoo, do Tesouro nem do BCB: qualquer chamada faria o teste falhar.
      await seedPosition('PETR4', { yfTicker: 'PETR4.SA' })
      await seedPosition('TD:SELIC2029', {
        type: 'TESOURO_DIRETO',
        yfTicker: 'Tesouro Selic;01/03/2029',
      })
      await createPriceHistory(db, 'PETR4', '2024-06-27', 42)
      await createPriceHistory(db, 'TD:SELIC2029', '2024-06-26', 14215.6)

      const positions = await service.buildPositions(await db.asset.findMany(), TODAY)
      const byTicker = new Map(positions.map((p) => [p.ticker, p]))

      expect(byTicker.get('PETR4')?.currentPrice).toBe(42)
      expect(byTicker.get('PETR4')?.priceDate).toBe('2024-06-27')
      expect(byTicker.get('TD:SELIC2029')?.priceDate).toBe('2024-06-26')
      expect(await db.priceHistory.count({ where: { date: TODAY } })).toBe(0)
    })

    it('sem preço gravado, a data também fica nula', async () => {
      await seedPosition('PETR4')

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.priceDate).toBeNull()
    })

    it('converte pela última taxa gravada, mesmo sem a de hoje, sem chamar o BCB', async () => {
      await createAsset(db, 'AAPL', { currency: 'USD' })
      await createTransaction(db, 'AAPL', { quantity: 10, price: 100, date: '2024-01-01' })
      await assets.refreshPositionFields('AAPL')
      await createPriceHistory(db, 'AAPL', '2024-06-01', 150)
      await createExchangeRate(db, '2024-06-27', 5.2)

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.exchangeRate).toBeCloseTo(5.2, 3)
      expect(position?.currentValueBrl).toBeCloseTo(7800, 3)
    })

    it('ativo deslistado usa o histórico', async () => {
      await seedPosition('OIBR3', { delisted: true })
      await createPriceHistory(db, 'OIBR3', '2024-06-01', 1)

      const [position] = await service.buildPositions(await db.asset.findMany(), TODAY)

      expect(position?.currentPrice).toBe(1)
      expect(position?.delisted).toBe(true)
    })
  })

  describe('aggregatePositions', () => {
    it('soma os totais da carteira', async () => {
      await seedPosition('PETR4')
      await seedPosition('VALE3')
      await createPriceHistory(db, 'PETR4', '2024-06-01', 15)
      await createPriceHistory(db, 'VALE3', '2024-06-01', 20)

      const positions = await service.buildPositions(await db.asset.findMany(), TODAY)
      const summary = service.aggregatePositions(positions, TODAY)

      expect(summary.totalInvested).toBeCloseTo(200, 3)
      expect(summary.currentValue).toBeCloseTo(350, 3)
      expect(summary.unrealizedPnl).toBeCloseTo(150, 3)
      expect(summary.positions).toHaveLength(2)
    })

    it('sem posições devolve valores nulos', () => {
      const summary = service.aggregatePositions([], TODAY)

      expect(summary.totalInvested).toBe(0)
      expect(summary.netContribution).toBe(0)
      expect(summary.currentValue).toBeNull()
      expect(summary.unrealizedPnl).toBeNull()
      expect(summary.irrAnnual).toBeNull()
    })

    it('só compras: o aporte líquido é o próprio total investido', async () => {
      await seedPosition('PETR4')
      await seedPosition('VALE3')

      const positions = await service.buildPositions(await db.asset.findMany(), TODAY)
      const summary = service.aggregatePositions(positions, TODAY)

      expect(summary.netContribution).toBeCloseTo(summary.totalInvested, 3)
      expect(summary.netContribution).toBeCloseTo(200, 3)
    })

    it('provento de um ativo pagando a compra de outro não é aporte novo', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-01' })
      await assets.refreshPositionFields('PETR4')
      await createDividend(db, 'PETR4', { totalAmount: 60, taxWithheld: 0, date: '2024-02-01' })

      await createAsset(db, 'VALE3')
      await createTransaction(db, 'VALE3', { quantity: 10, price: 10, date: '2024-03-01' })
      await assets.refreshPositionFields('VALE3')

      const positions = await service.buildPositions(await db.asset.findMany(), TODAY)
      const summary = service.aggregatePositions(positions, TODAY)

      expect(summary.totalInvested).toBeCloseTo(200, 3)
      expect(summary.netContribution).toBeCloseTo(140, 3)
    })

    it('soma o resultado de proventos', async () => {
      await seedPosition('PETR4')
      await createDividend(db, 'PETR4', { totalAmount: 100, taxWithheld: 0 })

      const positions = await service.buildPositions(await db.asset.findMany(), TODAY)
      expect(service.aggregatePositions(positions, TODAY).dividendPnl).toBeCloseTo(100, 3)
    })
  })
})
