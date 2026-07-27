import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset } from '../../../tests/factories.js'
import { server, yahooChart, yahooChartBySymbol } from '../../../tests/msw.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { DividendService } from '../dividend/dividend.service.js'
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import { TransactionService } from '../transaction/transaction.service.js'
import { CsvImportService } from './csv-import.service.js'

// Porte da parte de I/O de CsvParsingServiceTest.kt e DividendCsvParsingServiceTest.kt

describe('CsvImportService', () => {
  let db: TestDb
  let service: CsvImportService

  beforeAll(async () => {
    db = await createTestDb()
    const yahoo = new YahooClient()
    const exchangeRates = new ExchangeRateService(db, new BcbClient())
    const transactions = new TransactionService(db, yahoo, exchangeRates)
    const dividends = new DividendService(db, transactions, exchangeRates)
    service = new CsvImportService(db, yahoo, transactions, dividends)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('parseCsvWithAssetLookup', () => {
    it('ticker cadastrado recebe EXISTS sem consultar o Yahoo', async () => {
      await createAsset(db, 'PETR4')

      const rows = await service.parseCsvWithAssetLookup(
        'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
      )

      expect(rows[0]?.assetStatus).toBe('EXISTS')
    })

    it('ticker encontrado no Yahoo recebe WILL_CREATE', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      const rows = await service.parseCsvWithAssetLookup(
        'PETR3\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
      )

      expect(rows[0]?.assetStatus).toBe('WILL_CREATE')
    })

    it('ticker não encontrado recebe UNKNOWN', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      const rows = await service.parseCsvWithAssetLookup(
        'XXXX9\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
      )

      expect(rows[0]?.assetStatus).toBe('UNKNOWN')
    })
  })

  describe('extractDistinctAssets', () => {
    it('ativo cadastrado usa os dados do banco', async () => {
      await createAsset(db, 'PETR4', { name: 'Petrobras', yfTicker: 'PETR4.SA' })

      const rows = await service.extractDistinctAssets(
        'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
      )

      expect(rows).toEqual([
        {
          ticker: 'PETR4',
          name: 'Petrobras',
          type: 'STOCK',
          yfTicker: 'PETR4.SA',
          currency: 'BRL',
          assetStatus: 'EXISTS',
        },
      ])
    })

    it('ativo novo usa os dados do Yahoo', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      const rows = await service.extractDistinctAssets(
        'PETR3\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
      )

      expect(rows[0]?.assetStatus).toBe('WILL_CREATE')
      expect(rows[0]?.name).toContain('Petrobras')
    })

    it('deduplica tickers repetidos', async () => {
      await createAsset(db, 'PETR4')

      const csv =
        'PETR4\t01/06/2024\tC\t1\t1\t0\tXP\t0\tBRL\t\nPETR4\t02/06/2024\tC\t1\t1\t0\tXP\t0\tBRL\t'
      expect(await service.extractDistinctAssets(csv)).toHaveLength(1)
    })
  })

  describe('batchImport', () => {
    it('cadastra os ativos novos e insere as transações', async () => {
      server.use(yahooChartBySymbol({}))

      const inserted = await service.batchImport(
        [
          {
            ticker: 'PETR4',
            date: '2024-06-01',
            type: 'BUY',
            quantity: 100,
            price: 25.5,
            fees: 10,
            broker: 'XP',
            notes: '',
            currency: 'BRL',
          },
        ],
        [
          {
            ticker: 'PETR4',
            name: 'Petrobras',
            type: 'STOCK',
            yfTicker: 'PETR4.SA',
            currency: 'BRL',
          },
        ],
      )

      expect(inserted).toBe(1)
      expect(await db.asset.count()).toBe(1)
      expect(await db.transaction.count()).toBe(1)
    })

    it('não duplica ativo que já existe', async () => {
      await createAsset(db, 'PETR4', { name: 'Original' })

      await service.batchImport(
        [],
        [{ ticker: 'PETR4', name: 'Outro', type: 'STOCK', yfTicker: '', currency: 'BRL' }],
      )

      const asset = await db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.name).toBe('Original')
    })

    it('venda entra com quantidade negativa', async () => {
      await createAsset(db, 'PETR4')

      await service.batchImport([
        {
          ticker: 'PETR4',
          date: '2024-06-01',
          type: 'SELL',
          quantity: -50,
          price: 30,
          fees: 0,
          broker: '',
          notes: '',
          currency: 'BRL',
        },
      ])

      const tx = await db.transaction.findFirstOrThrow()
      expect(tx.quantity).toBe(-50)
    })

    it('agrupamento entra com quantidade negativa mesmo vindo positivo', async () => {
      await createAsset(db, 'PETR4')

      await service.batchImport([
        {
          ticker: 'PETR4',
          date: '2024-06-01',
          type: 'AGRUPAMENTO',
          quantity: 900,
          price: 0,
          fees: 0,
          broker: '',
          notes: '',
          currency: 'BRL',
        },
      ])

      const tx = await db.transaction.findFirstOrThrow()
      expect(tx).toMatchObject({ type: 'AGRUPAMENTO', quantity: -900 })
    })

    it('desdobramento importado descarta preço e taxas da planilha', async () => {
      await createAsset(db, 'PETR4')

      await service.batchImport([
        {
          ticker: 'PETR4',
          date: '2024-06-01',
          type: 'DESDOBRAMENTO',
          quantity: 100,
          price: 25,
          fees: 8,
          broker: '',
          notes: '',
          currency: 'BRL',
        },
      ])

      const tx = await db.transaction.findFirstOrThrow()
      expect(tx).toMatchObject({ type: 'DESDOBRAMENTO', quantity: 100, price: 0, fees: 0 })
    })

    it('bonificação importada mantém o custo atribuído', async () => {
      await createAsset(db, 'PETR4')

      await service.batchImport([
        {
          ticker: 'PETR4',
          date: '2024-06-01',
          type: 'BONIFICACAO',
          quantity: 10,
          price: 5,
          fees: 3,
          broker: '',
          notes: '',
          currency: 'BRL',
        },
      ])

      const tx = await db.transaction.findFirstOrThrow()
      expect(tx).toMatchObject({ type: 'BONIFICACAO', quantity: 10, price: 5, fees: 0 })
    })

    it('lista vazia insere zero', async () => {
      expect(await service.batchImport([])).toBe(0)
    })
  })

  describe('proventos', () => {
    it('parseDividendCsv marca ativo não cadastrado', async () => {
      const rows = await service.parseDividendCsv(
        'XXXX9\t01/03/2026\tDIVIDENDO\t1,00\t0,00\tBRL\tXP',
      )

      expect(rows[0]?.error).toContain('Ativo não cadastrado')
    })

    it('parseDividendCsv aceita ativo cadastrado', async () => {
      await createAsset(db, 'PETR4')

      const rows = await service.parseDividendCsv(
        'PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP',
      )

      expect(rows[0]?.error).toBeNull()
    })

    it('batchImportDividends grava no banco', async () => {
      await createAsset(db, 'PETR4')
      await createAsset(db, 'VALE3')

      const inserted = await service.batchImportDividends([
        {
          ticker: 'PETR4',
          date: '2026-03-01',
          type: 'DIVIDENDO',
          totalAmount: 1.5,
          taxWithheld: 0,
          currency: 'BRL',
          broker: 'XP',
          notes: 'Teste',
        },
        {
          ticker: 'VALE3',
          date: '2026-02-15',
          type: 'JCP',
          totalAmount: 2.3,
          taxWithheld: 0.35,
          currency: 'BRL',
          broker: 'Clear',
          notes: '',
        },
      ])

      expect(inserted).toBe(2)
      expect(await db.dividend.count()).toBe(2)
    })
  })
})
