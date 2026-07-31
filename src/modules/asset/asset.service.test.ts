import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import {
  createAsset,
  createTransaction,
  seedDefaultAssetClasses,
} from '../../../tests/factories.js'
import { TesouroClient } from '../../integrations/tesouro/tesouro.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { AssetClassService } from '../allocation/asset-class.service.js'
import { PriceHistoryService } from '../price-history/price-history.service.js'
import { AssetRequest } from './asset.schema.js'
import { AssetService } from './asset.service.js'

// O AssetService não tinha teste unitário no Kotlin — era exercitado só pelo
// AssetControllerTest. Testado aqui no nível certo; as rotas vêm na fase 5.

describe('AssetService', () => {
  let db: TestDb
  let service: AssetService

  beforeAll(async () => {
    db = await createTestDb()
    service = new AssetService(
      db,
      new AssetClassService(db),
      new PriceHistoryService(db, new YahooClient(), new TesouroClient()),
    )
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('create', () => {
    it('cria com os padrões', async () => {
      const asset = await service.create(AssetRequest.parse({ ticker: 'petr4' }))

      expect(asset).toMatchObject({ ticker: 'PETR4', type: 'STOCK', currency: 'BRL' })
    })

    it('nasce na classe de alocação padrão do tipo', async () => {
      await seedDefaultAssetClasses(db)

      await service.create(AssetRequest.parse({ ticker: 'HGLG11', type: 'REIT' }))

      const asset = await db.asset.findUniqueOrThrow({
        where: { ticker: 'HGLG11' },
        include: { assetClass: true },
      })
      expect(asset.assetClass?.name).toBe('Fii')
    })

    it('tipo sem classe padrão fica sem classe, não em uma qualquer', async () => {
      await seedDefaultAssetClasses(db)

      await service.create(AssetRequest.parse({ ticker: 'XPTO3', type: 'OUTROS' }))

      const asset = await db.asset.findUniqueOrThrow({ where: { ticker: 'XPTO3' } })
      expect(asset.assetClassId).toBeNull()
    })

    it('normaliza o ticker no schema, antes de chegar ao service', async () => {
      await service.create(AssetRequest.parse({ ticker: '  vale3  ' }))

      expect(await db.asset.findUnique({ where: { ticker: 'VALE3' } })).not.toBeNull()
    })

    it('rejeita ticker duplicado com 409', async () => {
      await service.create(AssetRequest.parse({ ticker: 'PETR4' }))

      await expect(service.create(AssetRequest.parse({ ticker: 'PETR4' }))).rejects.toMatchObject({
        statusCode: 409,
      })
    })

    it('rejeita tipo fora da lista na validação do schema', () => {
      expect(() => AssetRequest.parse({ ticker: 'PETR4', type: 'INVALIDO' })).toThrow()
    })
  })

  describe('findFiltered', () => {
    beforeEach(async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: true })
      await createAsset(db, 'HGLG11', { type: 'REIT', hasPosition: false })
      await createAsset(db, 'OIBR3', { type: 'STOCK', hasPosition: false, delisted: true })
    })

    it('sem filtro devolve tudo ordenado por ticker', async () => {
      const result = await service.findFiltered({})
      expect(result.map((a) => a.ticker)).toEqual(['HGLG11', 'OIBR3', 'PETR4'])
    })

    it('filtra por tipo', async () => {
      const result = await service.findFiltered({ type: 'REIT' })
      expect(result.map((a) => a.ticker)).toEqual(['HGLG11'])
    })

    it('filtra por posição', async () => {
      expect((await service.findFiltered({ position: 'with' })).map((a) => a.ticker)).toEqual([
        'PETR4',
      ])
      expect((await service.findFiltered({ position: 'without' })).map((a) => a.ticker)).toEqual([
        'HGLG11',
        'OIBR3',
      ])
    })

    it('position=all não filtra', async () => {
      expect(await service.findFiltered({ position: 'all' })).toHaveLength(3)
    })

    it('filtra por deslistado', async () => {
      expect((await service.findFiltered({ delisted: 'delisted' })).map((a) => a.ticker)).toEqual([
        'OIBR3',
      ])
      expect((await service.findFiltered({ delisted: 'active' })).map((a) => a.ticker)).toEqual([
        'HGLG11',
        'PETR4',
      ])
    })

    it('combina filtros', async () => {
      const result = await service.findFiltered({ type: 'STOCK', delisted: 'active' })
      expect(result.map((a) => a.ticker)).toEqual(['PETR4'])
    })
  })

  describe('findById e exists', () => {
    it('busca sem depender de maiúsculas', async () => {
      await createAsset(db, 'PETR4')
      expect(await service.findById('petr4')).toMatchObject({ ticker: 'PETR4' })
      expect(await service.exists('petr4')).toBe(true)
    })

    it('devolve null e false quando não existe', async () => {
      expect(await service.findById('XXXX9')).toBeNull()
      expect(await service.exists('XXXX9')).toBe(false)
    })
  })

  describe('update', () => {
    it('atualiza os campos', async () => {
      await createAsset(db, 'PETR4')

      const updated = await service.update('petr4', {
        name: 'Petrobras PN',
        type: 'STOCK',
        yfTicker: 'PETR4.SA',
        currency: 'BRL',
        delisted: true,
      })

      expect(updated.asset).toMatchObject({
        name: 'Petrobras PN',
        yfTicker: 'PETR4.SA',
        delisted: true,
      })
    })

    it('campo em branco vira null', async () => {
      await createAsset(db, 'PETR4', { name: 'Petrobras', yfTicker: 'PETR4.SA' })

      const updated = await service.update('PETR4', { name: '', yfTicker: '', delisted: false })

      expect(updated.asset.name).toBeNull()
      expect(updated.asset.yfTicker).toBeNull()
    })

    it('moeda em branco preserva a atual', async () => {
      await createAsset(db, 'AAPL', { currency: 'USD' })

      const updated = await service.update('AAPL', { currency: '', delisted: false })

      expect(updated.asset.currency).toBe('USD')
    })

    it('ativo inexistente dá 404', async () => {
      await expect(service.update('XXXX9', { delisted: false })).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('delete', () => {
    it('apaga o ativo e suas transações em cascata', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4')

      await service.delete('petr4')

      expect(await db.asset.count()).toBe(0)
      expect(await db.transaction.count()).toBe(0)
    })

    it('ativo inexistente dá 404', async () => {
      await expect(service.delete('XXXX9')).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('refreshPositionFields', () => {
    it('calcula posição a partir das transações', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-01' })
      await createTransaction(db, 'PETR4', { quantity: 10, price: 20, date: '2024-01-02' })

      await service.refreshPositionFields('PETR4')

      const asset = await db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.hasPosition).toBe(true)
      expect(asset.quantity).toBeCloseTo(20, 3)
      expect(asset.avgPrice).toBeCloseTo(15, 3)
      expect(asset.totalCost).toBeCloseTo(300, 3)
    })

    it('sem transações zera todos os campos', async () => {
      await createAsset(db, 'PETR4', { hasPosition: true, quantity: 99, avgPrice: 10 })

      await service.refreshPositionFields('PETR4')

      const asset = await db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.hasPosition).toBe(false)
      expect(asset.quantity).toBe(0)
      expect(asset.avgPrice).toBe(0)
    })

    it('venda total marca posição como encerrada', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-01' })
      await createTransaction(db, 'PETR4', {
        type: 'SELL',
        quantity: -10,
        price: 15,
        date: '2024-01-02',
      })

      await service.refreshPositionFields('PETR4')

      const asset = await db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.hasPosition).toBe(false)
      expect(asset.realizedPnl).toBeCloseTo(50, 3)
    })

    it('ativo inexistente não lança', async () => {
      await expect(service.refreshPositionFields('XXXX9')).resolves.toBeUndefined()
    })
  })

  describe('refreshAllPositionFields', () => {
    it('recalcula todos numa passada, sem N+1', async () => {
      await createAsset(db, 'PETR4')
      await createAsset(db, 'VALE3')
      await createAsset(db, 'SEMTX3')
      await createTransaction(db, 'PETR4', { quantity: 10, price: 10 })
      await createTransaction(db, 'VALE3', { quantity: 5, price: 60 })

      await service.refreshAllPositionFields()

      const assets = await db.asset.findMany({ orderBy: { ticker: 'asc' } })
      expect(assets.map((a) => [a.ticker, a.hasPosition])).toEqual([
        ['PETR4', true],
        ['SEMTX3', false],
        ['VALE3', true],
      ])
      expect(assets.find((a) => a.ticker === 'VALE3')?.avgPrice).toBeCloseTo(60, 3)
    })
  })

  describe('computeTickersWithPosition', () => {
    it('devolve só os que têm posição', async () => {
      await createAsset(db, 'PETR4', { hasPosition: true })
      await createAsset(db, 'VALE3', { hasPosition: false })

      expect([...(await service.computeTickersWithPosition())]).toEqual(['PETR4'])
    })
  })
})
