import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset, createExchangeRate, createTransaction } from '../../../tests/factories.js'
import { server, yahooChart } from '../../../tests/msw.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import { TransactionService } from './transaction.service.js'

// Porte de src/test/kotlin/com/stocks/service/TransactionServiceTest.kt

describe('TransactionService', () => {
  let db: TestDb
  let service: TransactionService

  beforeAll(async () => {
    db = await createTestDb()
    service = new TransactionService(
      db,
      new YahooClient(),
      new ExchangeRateService(db, new BcbClient()),
    )
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('resolvePrice', () => {
    it('preço e taxas informados diretamente', () => {
      expect(service.resolvePrice(25.5, null, 10, 100)).toEqual({ price: 25.5, fees: 10 })
    })

    it('valor total com preço unitário calcula as taxas', () => {
      // 100 × 25 = 2500; total 2510 ⇒ taxas 10
      expect(service.resolvePrice(25, 2510, 0, 100)).toEqual({ price: 25, fees: 10 })
    })

    it('valor total sem preço unitário calcula o preço', () => {
      // (2510 − 10) / 100 = 25
      expect(service.resolvePrice(null, 2510, 10, 100)).toEqual({ price: 25, fees: 10 })
    })

    it('sem preço e sem total dá 400', () => {
      expect(() => service.resolvePrice(null, null, 0, 100)).toThrow(
        /Informe o preço unitário ou o valor total/,
      )
    })

    it('preço zero e sem total dá 400', () => {
      expect(() => service.resolvePrice(0, null, 0, 100)).toThrow()
    })
  })

  describe('convertPrices', () => {
    it('mesma moeda BRL não converte', async () => {
      expect(await service.convertPrices(30, 1, 'BRL', 'BRL', isoDate('2024-01-15'))).toEqual({
        price: 30,
        fees: 1,
        priceBrl: 30,
        feesBrl: 1,
      })
    })

    it('mesma moeda USD converte só o valor em reais', async () => {
      await createExchangeRate(db, '2024-01-15', 5)

      expect(await service.convertPrices(100, 2, 'USD', 'USD', isoDate('2024-01-15'))).toEqual({
        price: 100,
        fees: 2,
        priceBrl: 500,
        feesBrl: 10,
      })
    })

    it('entrada em BRL para ativo em USD divide pela taxa', async () => {
      await createExchangeRate(db, '2024-01-15', 5)

      expect(await service.convertPrices(500, 10, 'BRL', 'USD', isoDate('2024-01-15'))).toEqual({
        price: 100,
        fees: 2,
        priceBrl: 500,
        feesBrl: 10,
      })
    })

    it('entrada em USD para ativo em BRL multiplica pela taxa', async () => {
      await createExchangeRate(db, '2024-01-15', 5)

      expect(await service.convertPrices(100, 2, 'USD', 'BRL', isoDate('2024-01-15'))).toEqual({
        price: 500,
        fees: 10,
        priceBrl: 500,
        feesBrl: 10,
      })
    })
  })

  describe('findOrCreateAsset', () => {
    it('devolve o ativo existente sem consultar o Yahoo', async () => {
      await createAsset(db, 'PETR4', { name: 'Petrobras' })

      const asset = await service.findOrCreateAsset('petr4')

      expect(asset.name).toBe('Petrobras')
    })

    it('cria o ativo com os dados do Yahoo quando não existe', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      const asset = await service.findOrCreateAsset('PETR3')

      expect(asset.ticker).toBe('PETR3')
      expect(asset.name).toContain('Petrobras')
      expect(asset.currency).toBe('BRL')
    })

    it('ticker não encontrado grava nome nulo', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      const asset = await service.findOrCreateAsset('XXXX9')

      expect(asset.name).toBeNull()
    })
  })

  describe('createTransaction', () => {
    it('grava compra com quantidade positiva', async () => {
      await createAsset(db, 'PETR4')

      const tx = await service.createTransaction('petr4', {
        type: 'BUY',
        quantity: 100,
        price: 25.5,
        fees: 10,
        date: isoDate('2024-06-01'),
      })

      expect(tx).toMatchObject({ assetId: 'PETR4', type: 'BUY', quantity: 100, price: 25.5 })
    })

    it('venda é gravada com quantidade negativa', async () => {
      await createAsset(db, 'PETR4')

      const tx = await service.createTransaction('PETR4', {
        type: 'sell',
        quantity: 50,
        price: 30,
        fees: 0,
        date: isoDate('2024-06-01'),
      })

      expect(tx.type).toBe('SELL')
      expect(tx.quantity).toBe(-50)
    })

    it('corretora e observação em branco viram null', async () => {
      await createAsset(db, 'PETR4')

      const tx = await service.createTransaction('PETR4', {
        type: 'BUY',
        quantity: 10,
        price: 25,
        fees: 0,
        date: isoDate('2024-06-01'),
        broker: '   ',
        notes: '',
      })

      expect(tx.broker).toBeNull()
      expect(tx.notes).toBeNull()
    })

    it('a moeda gravada é sempre a do ativo', async () => {
      await createAsset(db, 'AAPL', { currency: 'USD' })
      await createExchangeRate(db, '2024-06-01', 5)

      const tx = await service.createTransaction('AAPL', {
        type: 'BUY',
        quantity: 10,
        price: 500,
        fees: 0,
        date: isoDate('2024-06-01'),
        inputCurrency: 'BRL',
      })

      expect(tx.currency).toBe('USD')
      expect(tx.price).toBeCloseTo(100, 3)
      expect(tx.priceBrl).toBeCloseTo(500, 3)
    })
  })

  describe('createTransactionForExistingAsset', () => {
    it('ativo inexistente dá 404', async () => {
      await expect(
        service.createTransactionForExistingAsset('XXXX9', {
          type: 'BUY',
          quantity: 1,
          price: 1,
          fees: 0,
          date: isoDate('2024-06-01'),
        }),
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('listTransactions', () => {
    beforeEach(async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: true })
      await createAsset(db, 'HGLG11', { type: 'REIT', hasPosition: false })
      await createTransaction(db, 'PETR4', { date: '2024-01-10' })
      await createTransaction(db, 'PETR4', { date: '2024-03-20' })
      await createTransaction(db, 'HGLG11', { date: '2024-02-15' })
    })

    it('ordena por data decrescente', async () => {
      const result = await service.listTransactions()
      expect(result.map((t) => t.date)).toEqual(['2024-03-20', '2024-02-15', '2024-01-10'])
    })

    it('filtra por ticker', async () => {
      expect(await service.listTransactions({ ticker: 'petr4' })).toHaveLength(2)
    })

    it('filtra por tipo de ativo', async () => {
      const result = await service.listTransactions({ type: 'REIT' })
      expect(result.map((t) => t.assetId)).toEqual(['HGLG11'])
    })

    it('filtra por posição', async () => {
      const result = await service.listTransactions({ position: 'with' })
      expect(result.every((t) => t.assetId === 'PETR4')).toBe(true)
    })

    it('position=all não filtra', async () => {
      expect(await service.listTransactions({ position: 'all' })).toHaveLength(3)
    })
  })

  describe('updateTransaction e deleteTransaction', () => {
    it('atualiza e devolve o ticker afetado', async () => {
      await createAsset(db, 'PETR4')
      const tx = await createTransaction(db, 'PETR4')

      const assetId = await service.updateTransaction(tx.id, {
        type: 'SELL',
        quantity: 5,
        price: 40,
        fees: 2,
        date: isoDate('2024-07-01'),
      })

      expect(assetId).toBe('PETR4')
      const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })
      expect(updated.quantity).toBe(-5)
      expect(updated.price).toBe(40)
    })

    it('atualizar transação inexistente dá 404', async () => {
      await expect(
        service.updateTransaction(9999, {
          type: 'BUY',
          quantity: 1,
          price: 1,
          fees: 0,
          date: isoDate('2024-01-01'),
        }),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('apaga e devolve o ticker afetado', async () => {
      await createAsset(db, 'PETR4')
      const tx = await createTransaction(db, 'PETR4')

      expect(await service.deleteTransaction(tx.id)).toBe('PETR4')
      expect(await db.transaction.count()).toBe(0)
    })

    it('apagar transação inexistente dá 404', async () => {
      await expect(service.deleteTransaction(9999)).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('lookupTickerInfo', () => {
    it('ticker curto demais devolve NOT_FOUND sem consultar nada', async () => {
      expect(await service.lookupTickerInfo('AB')).toEqual({
        ticker: 'AB',
        name: null,
        type: null,
        status: 'NOT_FOUND',
      })
    })

    it('ticker cadastrado devolve EXISTS', async () => {
      await createAsset(db, 'PETR4', { name: 'Petrobras', type: 'STOCK' })

      expect(await service.lookupTickerInfo('petr4')).toMatchObject({
        ticker: 'PETR4',
        name: 'Petrobras',
        status: 'EXISTS',
      })
    })

    it('ticker encontrado no Yahoo devolve FOUND_ONLINE', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      const result = await service.lookupTickerInfo('PETR3')
      expect(result.status).toBe('FOUND_ONLINE')
      expect(result.name).toContain('Petrobras')
    })

    it('ticker não encontrado devolve NOT_FOUND', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      expect(await service.lookupTickerInfo('XXXX9')).toMatchObject({ status: 'NOT_FOUND' })
    })
  })
})
