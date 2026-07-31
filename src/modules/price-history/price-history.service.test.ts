import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset, createPriceHistory, createTransaction } from '../../../tests/factories.js'
import { server, tesouroCsv, yahooChart, yahooError } from '../../../tests/msw.js'
import { TesouroClient } from '../../integrations/tesouro/tesouro.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { PriceHistoryService } from './price-history.service.js'

// Porte da parte de integração de src/test/kotlin/com/stocks/service/PriceHistoryServiceTest.kt

const TODAY = isoDate('2024-06-30')

describe('PriceHistoryService', () => {
  let db: TestDb
  let service: PriceHistoryService

  beforeAll(async () => {
    db = await createTestDb()
    service = new PriceHistoryService(db, new YahooClient(), new TesouroClient())
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('consultas', () => {
    it('getLatestPrice devolve o preço mais recente', async () => {
      await createAsset(db, 'PETR4')
      await createPriceHistory(db, 'PETR4', '2024-01-10', 30)
      await createPriceHistory(db, 'PETR4', '2024-03-20', 35)
      await createPriceHistory(db, 'PETR4', '2024-02-15', 32)

      expect(await service.getLatestPrice('PETR4')).toBe(35)
    })

    it('getLatestPrice devolve null sem preços', async () => {
      expect(await service.getLatestPrice('PETR4')).toBeNull()
    })

    it('getLastStoredDate devolve a data mais recente', async () => {
      await createAsset(db, 'PETR4')
      await createPriceHistory(db, 'PETR4', '2024-01-10', 30)
      await createPriceHistory(db, 'PETR4', '2024-03-20', 35)

      expect(await service.getLastStoredDate('PETR4')).toBe('2024-03-20')
    })

    it('getLastStoredDate devolve null sem preços', async () => {
      expect(await service.getLastStoredDate('PETR4')).toBeNull()
    })

    it('getPricesForDate devolve o preço de vários ativos na data', async () => {
      await createAsset(db, 'PETR4')
      await createAsset(db, 'VALE3')
      await createPriceHistory(db, 'PETR4', '2024-01-10', 30)
      await createPriceHistory(db, 'VALE3', '2024-01-10', 60)
      await createPriceHistory(db, 'VALE3', '2024-01-11', 61)

      const prices = await service.getPricesForDate(['PETR4', 'VALE3'], isoDate('2024-01-10'))
      expect(Object.fromEntries(prices)).toEqual({ PETR4: 30, VALE3: 60 })
    })
  })

  describe('upsertPrices', () => {
    it('insere registros novos', async () => {
      await createAsset(db, 'PETR4')

      await service.upsertPrices([
        { assetId: 'PETR4', date: isoDate('2024-01-10'), close: 30 },
        { assetId: 'PETR4', date: isoDate('2024-01-11'), close: 31 },
      ])

      expect(await db.priceHistory.count()).toBe(2)
    })

    it('atualiza registro existente em vez de duplicar', async () => {
      await createAsset(db, 'PETR4')
      await createPriceHistory(db, 'PETR4', '2024-01-10', 30)

      await service.upsertPrices([{ assetId: 'PETR4', date: isoDate('2024-01-10'), close: 99 }])

      expect(await db.priceHistory.count()).toBe(1)
      expect(await service.getLatestPrice('PETR4')).toBe(99)
    })

    it('lista vazia não faz nada', async () => {
      await service.upsertPrices([])
      expect(await db.priceHistory.count()).toBe(0)
    })
  })

  describe('generateDelistedPrices', () => {
    it('sem transações não gera nada', async () => {
      await createAsset(db, 'OIBR3', { delisted: true })

      await service.generateDelistedPrices('OIBR3', TODAY)

      expect(await db.priceHistory.count()).toBe(0)
    })

    it('uma transação repete o preço até hoje', async () => {
      await createAsset(db, 'OIBR3', { delisted: true })
      await createTransaction(db, 'OIBR3', { date: '2024-06-25', price: 10 })

      await service.generateDelistedPrices('OIBR3', TODAY)

      const prices = await db.priceHistory.findMany({ orderBy: { date: 'asc' } })
      expect(prices).toHaveLength(6) // 25/06 a 30/06
      expect(prices.every((p) => p.close === 10)).toBe(true)
    })

    it('duas transações interpolam linearmente entre elas', async () => {
      await createAsset(db, 'OIBR3', { delisted: true })
      await createTransaction(db, 'OIBR3', { date: '2024-06-20', price: 10 })
      await createTransaction(db, 'OIBR3', { date: '2024-06-30', price: 20 })

      await service.generateDelistedPrices('OIBR3', TODAY)

      const middle = await db.priceHistory.findFirst({ where: { date: '2024-06-25' } })
      expect(middle?.close).toBeCloseTo(15, 3)
    })
  })

  describe('runBackfill', () => {
    it('ativo deslistado não consulta o Yahoo', async () => {
      await createAsset(db, 'OIBR3', { delisted: true })
      await createTransaction(db, 'OIBR3', { date: '2024-06-25', price: 10 })

      // Sem handler do Yahoo: qualquer chamada quebraria o teste (onUnhandledRequest: 'error').
      await service.runBackfill(TODAY)

      expect(await db.priceHistory.count()).toBeGreaterThan(0)
    })

    it('ativo comum busca e grava o histórico', async () => {
      server.use(yahooChart('yahoo_chart_historical.json'))
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA' })
      await createTransaction(db, 'PETR3', { date: '2024-01-01' })

      await service.runBackfill(TODAY)

      expect(await db.priceHistory.count()).toBeGreaterThan(0)
    })

    it('ativo sem transação é ignorado', async () => {
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA' })

      await service.runBackfill(TODAY)

      expect(await db.priceHistory.count()).toBe(0)
    })

    it('erro da API não derruba o backfill', async () => {
      server.use(yahooError(500))
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA' })
      await createTransaction(db, 'PETR3', { date: '2024-01-01' })

      await expect(service.runBackfill(TODAY)).resolves.toBeUndefined()
      expect(await db.priceHistory.count()).toBe(0)
    })

    it('Tesouro Direto usa o CSV, não o Yahoo', async () => {
      server.use(tesouroCsv('tesouro_direto_sample.csv'))
      await createAsset(db, 'TD1', {
        type: 'TESOURO_DIRETO',
        yfTicker: 'Tesouro Selic;01/03/2029',
      })
      await createTransaction(db, 'TD1', { date: '2024-01-01' })

      await service.runBackfill(isoDate('2024-03-31'))

      expect(await db.priceHistory.count()).toBe(3)
    })

    it('retoma a partir do último preço quando a série já cobre a primeira transação', async () => {
      server.use(yahooChart('yahoo_chart_historical.json'))
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA' })
      await createTransaction(db, 'PETR3', { date: '2024-01-01' })
      await createPriceHistory(db, 'PETR3', '2023-12-20', 38)
      await createPriceHistory(db, 'PETR3', '2024-06-29', 40)

      await service.runBackfill(TODAY)

      // O fixture é de março; com o corte em 30/06 nada novo entra.
      expect(await db.priceHistory.count()).toBe(2)
    })

    it('busca o histórico antigo quando a série começa depois da primeira transação', async () => {
      server.use(yahooChart('yahoo_chart_historical.json'))
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA' })
      await createTransaction(db, 'PETR3', { date: '2024-01-01' })
      // O que a atualização diária deixa para trás: só o preço de hoje.
      await createPriceHistory(db, 'PETR3', TODAY, 40)

      await service.runBackfill(TODAY)

      // Tomando o preço de hoje como marca d'água, o março do fixture nunca seria buscado.
      const dates = (await db.priceHistory.findMany({ select: { date: true } })).map((p) => p.date)
      expect(dates).toContain('2024-03-04')
    })
  })

  describe('runDailyUpdate', () => {
    it('grava só o preço de hoje', async () => {
      server.use(yahooChart('yahoo_chart_historical.json'))
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA', hasPosition: true })
      await createTransaction(db, 'PETR3', { date: '2024-01-01' })

      // O fixture não tem preço de 30/06, então nada é gravado.
      await service.runDailyUpdate(TODAY)

      expect(await db.priceHistory.count()).toBe(0)
    })

    it('ativo sem transação é ignorado', async () => {
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA' })

      await expect(service.runDailyUpdate(TODAY)).resolves.toBeUndefined()
    })

    it('posição encerrada não busca cotação', async () => {
      // Sem handler do Yahoo: se o serviço tentasse buscar, o teste estouraria na rede.
      await createAsset(db, 'MGLU3', { yfTicker: 'MGLU3.SA', hasPosition: false })
      await createTransaction(db, 'MGLU3', { date: '2024-01-01' })

      await service.runDailyUpdate(TODAY)

      expect(await db.priceHistory.count({ where: { assetId: 'MGLU3' } })).toBe(0)
    })

    it('deslistado sem posição não gera preço interpolado', async () => {
      await createAsset(db, 'HGTX3', { yfTicker: 'HGTX3.SA', delisted: true, hasPosition: false })
      await createTransaction(db, 'HGTX3', { date: '2024-01-01', price: 10 })

      await service.runDailyUpdate(TODAY)

      expect(await db.priceHistory.count({ where: { assetId: 'HGTX3' } })).toBe(0)
    })

    it('deslistado com posição continua gerando preço interpolado', async () => {
      await createAsset(db, 'HGTX3', { yfTicker: 'HGTX3.SA', delisted: true, hasPosition: true })
      await createTransaction(db, 'HGTX3', { date: '2024-01-01', price: 10 })

      await service.runDailyUpdate(TODAY)

      expect(await db.priceHistory.count({ where: { assetId: 'HGTX3' } })).toBeGreaterThan(0)
    })

    it('erro da API não derruba a atualização', async () => {
      server.use(yahooError(503))
      await createAsset(db, 'PETR3', { yfTicker: 'PETR3.SA', hasPosition: true })
      await createTransaction(db, 'PETR3', { date: '2024-01-01' })

      await expect(service.runDailyUpdate(TODAY)).resolves.toBeUndefined()
    })
  })
})
