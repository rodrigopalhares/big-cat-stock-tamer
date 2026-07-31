import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import {
  createAsset,
  createDividend,
  createPriceHistory,
  createTransaction,
} from '../../../tests/factories.js'
import { TesouroClient } from '../../integrations/tesouro/tesouro.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { AssetClassService } from '../allocation/asset-class.service.js'
import { AssetService } from '../asset/asset.service.js'
import { PriceHistoryService } from '../price-history/price-history.service.js'
import { EvolutionService } from './evolution.service.js'

// Porte da parte de integração de src/test/kotlin/com/stocks/service/MonthlyEvolutionServiceTest.kt

const TODAY = isoDate('2024-03-31')

describe('EvolutionService', () => {
  let db: TestDb
  let service: EvolutionService

  beforeAll(async () => {
    db = await createTestDb()
    const priceHistory = new PriceHistoryService(db, new YahooClient(), new TesouroClient())
    service = new EvolutionService(
      db,
      priceHistory,
      new AssetService(db, new AssetClassService(db)),
    )
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('recalculate', () => {
    it('sem transações não gera snapshot', async () => {
      await createAsset(db, 'PETR4')

      await service.recalculate(TODAY)

      expect(await db.monthlySnapshot.count()).toBe(0)
    })

    it('um ativo, um mês', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-03-01' })
      await createPriceHistory(db, 'PETR4', '2024-03-28', 15)

      await service.recalculate(TODAY)

      const snapshots = await db.monthlySnapshot.findMany()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toMatchObject({ assetId: 'PETR4', month: '2024-03-01', quantity: 10 })
      expect(snapshots[0]?.marketValue).toBeCloseTo(150, 3)
    })

    it('vários meses acumulam a posição', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-15' })
      await createTransaction(db, 'PETR4', { quantity: 10, price: 20, date: '2024-02-15' })
      await createPriceHistory(db, 'PETR4', '2024-01-31', 12)
      await createPriceHistory(db, 'PETR4', '2024-02-29', 18)
      await createPriceHistory(db, 'PETR4', '2024-03-28', 25)

      await service.recalculate(TODAY)

      const snapshots = await db.monthlySnapshot.findMany({ orderBy: { month: 'asc' } })
      expect(snapshots.map((s) => [s.month, s.quantity])).toEqual([
        ['2024-01-01', 10],
        ['2024-02-01', 20],
        ['2024-03-01', 20],
      ])
    })

    it('venda reduz a quantidade no mês seguinte', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-15' })
      await createTransaction(db, 'PETR4', {
        type: 'SELL',
        quantity: -6,
        price: 15,
        date: '2024-02-15',
      })
      await createPriceHistory(db, 'PETR4', '2024-01-31', 12)
      await createPriceHistory(db, 'PETR4', '2024-02-29', 15)

      await service.recalculate(isoDate('2024-02-29'))

      const snapshots = await db.monthlySnapshot.findMany({ orderBy: { month: 'asc' } })
      expect(snapshots.map((s) => s.quantity)).toEqual([10, 4])
    })

    it('mês com quantidade zerada é pulado', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-15' })
      await createTransaction(db, 'PETR4', {
        type: 'SELL',
        quantity: -10,
        price: 15,
        date: '2024-02-15',
      })
      await createPriceHistory(db, 'PETR4', '2024-01-31', 12)
      await createPriceHistory(db, 'PETR4', '2024-02-29', 15)

      await service.recalculate(isoDate('2024-02-29'))

      const snapshots = await db.monthlySnapshot.findMany()
      expect(snapshots.map((s) => s.month)).toEqual(['2024-01-01'])
    })

    it('mês sem preço de mercado é pulado', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-15' })

      await service.recalculate(TODAY)

      expect(await db.monthlySnapshot.count()).toBe(0)
    })

    it('é idempotente', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-03-01' })
      await createPriceHistory(db, 'PETR4', '2024-03-28', 15)

      await service.recalculate(TODAY)
      await service.recalculate(TODAY)

      expect(await db.monthlySnapshot.count()).toBe(1)
    })

    it('acumula os proventos líquidos até o mês', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-15' })
      await createPriceHistory(db, 'PETR4', '2024-01-31', 12)
      await createPriceHistory(db, 'PETR4', '2024-02-29', 13)
      await createDividend(db, 'PETR4', { date: '2024-01-20', totalAmount: 50, taxWithheld: 0 })
      await createDividend(db, 'PETR4', { date: '2024-02-20', totalAmount: 30, taxWithheld: 0 })

      await service.recalculate(isoDate('2024-02-29'))

      const snapshots = await db.monthlySnapshot.findMany({ orderBy: { month: 'asc' } })
      expect(snapshots.map((s) => s.accumulatedNetDividends)).toEqual([50, 80])
    })

    it('recalcula os campos de posição dos ativos', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-03-01' })
      await createPriceHistory(db, 'PETR4', '2024-03-28', 15)

      await service.recalculate(TODAY)

      const asset = await db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.hasPosition).toBe(true)
      expect(asset.quantity).toBeCloseTo(10, 3)
    })
  })

  describe('getEvolution', () => {
    it('sem snapshots devolve vazio', async () => {
      expect(await service.getEvolution()).toEqual({ months: [], tickers: [] })
    })

    it('preenche meses sem posição com zero', async () => {
      await createAsset(db, 'PETR4')
      await db.monthlySnapshot.createMany({
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
            assetId: 'PETR4',
            month: '2024-04-01',
            quantity: 10,
            avgPrice: 10,
            marketPrice: 15,
            totalCost: 100,
            marketValue: 150,
          },
        ],
      })

      const evolution = await service.getEvolution()

      expect(evolution.months.map((m) => m.month)).toEqual([
        '2024-01-01',
        '2024-02-01',
        '2024-03-01',
        '2024-04-01',
      ])
      expect(evolution.months[1]?.totalMarketValue).toBe(0)
      expect(evolution.months[1]?.snapshots).toEqual([])
    })

    it('lista os tickers ordenados e sem repetição', async () => {
      await createAsset(db, 'PETR4')
      await createAsset(db, 'VALE3')
      await db.monthlySnapshot.createMany({
        data: [
          {
            assetId: 'VALE3',
            month: '2024-01-01',
            quantity: 1,
            avgPrice: 1,
            marketPrice: 1,
            totalCost: 1,
            marketValue: 1,
          },
          {
            assetId: 'PETR4',
            month: '2024-01-01',
            quantity: 1,
            avgPrice: 1,
            marketPrice: 1,
            totalCost: 1,
            marketValue: 1,
          },
          {
            assetId: 'PETR4',
            month: '2024-02-01',
            quantity: 1,
            avgPrice: 1,
            marketPrice: 1,
            totalCost: 1,
            marketValue: 1,
          },
        ],
      })

      expect((await service.getEvolution()).tickers).toEqual(['PETR4', 'VALE3'])
    })

    it('separa proventos do mês dos acumulados', async () => {
      await createAsset(db, 'PETR4')
      await db.monthlySnapshot.createMany({
        data: [
          {
            assetId: 'PETR4',
            month: '2024-01-01',
            quantity: 1,
            avgPrice: 1,
            marketPrice: 1,
            totalCost: 1,
            marketValue: 1,
          },
          {
            assetId: 'PETR4',
            month: '2024-02-01',
            quantity: 1,
            avgPrice: 1,
            marketPrice: 1,
            totalCost: 1,
            marketValue: 1,
          },
        ],
      })
      await createDividend(db, 'PETR4', { date: '2024-01-20', totalAmount: 50, taxWithheld: 0 })
      await createDividend(db, 'PETR4', { date: '2024-02-20', totalAmount: 30, taxWithheld: 0 })

      const evolution = await service.getEvolution()

      expect(evolution.months[0]?.totalMonthlyNetDividends).toBe(50)
      expect(evolution.months[0]?.totalAccumulatedNetDividends).toBe(50)
      expect(evolution.months[1]?.totalMonthlyNetDividends).toBe(30)
      expect(evolution.months[1]?.totalAccumulatedNetDividends).toBe(80)
    })

    it('sem proventos os totais ficam zerados', async () => {
      await createAsset(db, 'PETR4')
      await db.monthlySnapshot.create({
        data: {
          assetId: 'PETR4',
          month: '2024-01-01',
          quantity: 1,
          avgPrice: 1,
          marketPrice: 1,
          totalCost: 1,
          marketValue: 1,
        },
      })

      const evolution = await service.getEvolution()

      expect(evolution.months[0]?.totalMonthlyNetDividends).toBe(0)
      expect(evolution.months[0]?.totalAccumulatedNetDividends).toBe(0)
    })
  })

  describe('findFirstTransactionMonth', () => {
    it('devolve null sem transações', async () => {
      expect(await service.findFirstTransactionMonth()).toBeNull()
    })

    it('devolve o mês da transação mais antiga entre todos os ativos', async () => {
      await createAsset(db, 'PETR4')
      await createAsset(db, 'VALE3')
      await createTransaction(db, 'PETR4', { date: '2024-03-15' })
      await createTransaction(db, 'VALE3', { date: '2023-11-20' })

      expect(await service.findFirstTransactionMonth()).toBe('2023-11')
    })
  })
})
