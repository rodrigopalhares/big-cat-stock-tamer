import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset, createDividend, createExchangeRate } from '../../../tests/factories.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import { TransactionService } from '../transaction/transaction.service.js'
import { DividendService } from './dividend.service.js'

// Porte de src/test/kotlin/com/stocks/service/DividendServiceTest.kt

describe('DividendService', () => {
  let db: TestDb
  let service: DividendService

  beforeAll(async () => {
    db = await createTestDb()
    const exchangeRates = new ExchangeRateService(db, new BcbClient())
    service = new DividendService(
      db,
      new TransactionService(db, new YahooClient(), exchangeRates),
      exchangeRates,
    )
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('createDividend', () => {
    it('cria para ativo existente', async () => {
      await createAsset(db, 'PETR4')

      const dividend = await service.createDividend('PETR4', {
        type: 'DIVIDENDO',
        date: isoDate('2024-03-01'),
        totalAmount: 150,
        taxWithheld: 0,
        notes: 'Teste',
      })

      expect(dividend).toMatchObject({
        assetId: 'PETR4',
        type: 'DIVIDENDO',
        date: '2024-03-01',
        totalAmount: 150,
        totalAmountBrl: 150,
        notes: 'Teste',
      })
    })

    it('normaliza o ticker para maiúsculas', async () => {
      await createAsset(db, 'PETR4')

      const dividend = await service.createDividend('  petr4  ', {
        type: 'dividendo',
        date: isoDate('2024-03-01'),
        totalAmount: 10,
        taxWithheld: 0,
      })

      expect(dividend.assetId).toBe('PETR4')
      expect(dividend.type).toBe('DIVIDENDO')
    })

    it('JCP com IR retido', async () => {
      await createAsset(db, 'VALE3')

      const dividend = await service.createDividend('VALE3', {
        type: 'JCP',
        date: isoDate('2024-02-15'),
        totalAmount: 230,
        taxWithheld: 34.5,
      })

      expect(dividend.type).toBe('JCP')
      expect(dividend.taxWithheld).toBeCloseTo(34.5, 3)
      expect(dividend.taxWithheldBrl).toBeCloseTo(34.5, 3)
    })

    it('observação em branco vira null', async () => {
      await createAsset(db, 'PETR4')

      const dividend = await service.createDividend('PETR4', {
        type: 'DIVIDENDO',
        date: isoDate('2024-03-01'),
        totalAmount: 10,
        taxWithheld: 0,
        notes: '   ',
        broker: '',
      })

      expect(dividend.notes).toBeNull()
      expect(dividend.broker).toBeNull()
    })

    it('provento em USD é convertido para reais pela cotação da data', async () => {
      await createAsset(db, 'AAPL', { currency: 'USD' })
      await createExchangeRate(db, '2024-03-01', 5)

      const dividend = await service.createDividend('AAPL', {
        type: 'DIVIDENDO',
        date: isoDate('2024-03-01'),
        totalAmount: 100,
        taxWithheld: 30,
        currency: 'USD',
      })

      expect(dividend.totalAmount).toBe(100)
      expect(dividend.totalAmountBrl).toBeCloseTo(500, 3)
      expect(dividend.taxWithheldBrl).toBeCloseTo(150, 3)
    })

    it('moeda em branco assume BRL', async () => {
      await createAsset(db, 'PETR4')

      const dividend = await service.createDividend('PETR4', {
        type: 'DIVIDENDO',
        date: isoDate('2024-03-01'),
        totalAmount: 10,
        taxWithheld: 0,
        currency: '',
      })

      expect(dividend.currency).toBe('BRL')
    })
  })

  describe('listDividends', () => {
    beforeEach(async () => {
      await createAsset(db, 'PETR4')
      await createAsset(db, 'VALE3')
      await createDividend(db, 'PETR4', { date: '2024-01-10', type: 'DIVIDENDO' })
      await createDividend(db, 'PETR4', { date: '2024-03-20', type: 'JCP' })
      await createDividend(db, 'VALE3', { date: '2024-02-15', type: 'DIVIDENDO' })
    })

    it('ordena por data decrescente', async () => {
      const result = await service.listDividends()
      expect(result.map((d) => d.date)).toEqual(['2024-03-20', '2024-02-15', '2024-01-10'])
    })

    it('filtra por ticker', async () => {
      expect(await service.listDividends('petr4')).toHaveLength(2)
    })

    it('filtra por tipo', async () => {
      const result = await service.listDividends(null, 'jcp')
      expect(result.map((d) => d.assetId)).toEqual(['PETR4'])
    })

    it('combina ticker e tipo', async () => {
      expect(await service.listDividends('PETR4', 'DIVIDENDO')).toHaveLength(1)
    })
  })

  describe('updateDividend e deleteDividend', () => {
    it('atualiza os campos', async () => {
      await createAsset(db, 'PETR4')
      const dividend = await createDividend(db, 'PETR4')

      await service.updateDividend(dividend.id, {
        type: 'JCP',
        date: isoDate('2024-05-01'),
        totalAmount: 250,
        taxWithheld: 37.5,
        notes: 'atualizado',
      })

      const updated = await db.dividend.findUniqueOrThrow({ where: { id: dividend.id } })
      expect(updated).toMatchObject({
        type: 'JCP',
        date: '2024-05-01',
        totalAmount: 250,
        notes: 'atualizado',
      })
    })

    it('atualizar inexistente dá 404', async () => {
      await expect(
        service.updateDividend(9999, {
          type: 'JCP',
          date: isoDate('2024-01-01'),
          totalAmount: 1,
          taxWithheld: 0,
        }),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('apaga', async () => {
      await createAsset(db, 'PETR4')
      const dividend = await createDividend(db, 'PETR4')

      await service.deleteDividend(dividend.id)

      expect(await db.dividend.count()).toBe(0)
    })

    it('apagar inexistente dá 404', async () => {
      await expect(service.deleteDividend(9999)).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('agregações', () => {
    it('getDividendPnlByAsset soma o líquido por ticker', async () => {
      await createAsset(db, 'PETR4')
      await createAsset(db, 'VALE3')
      await createDividend(db, 'PETR4', { totalAmount: 100, taxWithheld: 0 })
      await createDividend(db, 'PETR4', { totalAmount: 50, taxWithheld: 7.5 })
      await createDividend(db, 'VALE3', { totalAmount: 200, taxWithheld: 30 })

      const pnl = await service.getDividendPnlByAsset()

      expect(pnl.get('PETR4')).toBeCloseTo(142.5, 3)
      expect(pnl.get('VALE3')).toBeCloseTo(170, 3)
    })

    it('getDividendPnlByAsset devolve mapa vazio sem proventos', async () => {
      expect((await service.getDividendPnlByAsset()).size).toBe(0)
    })

    it('getDividendCashFlowsByAsset agrupa pares data-valor', async () => {
      await createAsset(db, 'PETR4')
      await createDividend(db, 'PETR4', { date: '2024-01-10', totalAmount: 100, taxWithheld: 0 })
      await createDividend(db, 'PETR4', { date: '2024-02-10', totalAmount: 50, taxWithheld: 7.5 })

      const flows = await service.getDividendCashFlowsByAsset()

      expect(flows.get('PETR4')).toEqual([
        { date: '2024-01-10', value: 100 },
        { date: '2024-02-10', value: 42.5 },
      ])
    })
  })
})
