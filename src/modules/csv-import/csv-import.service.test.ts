import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset } from '../../../tests/factories.js'
import { server, yahooChart, yahooChartBySymbol } from '../../../tests/msw.js'
import { buildXlsx, movimentacaoXlsx } from '../../../tests/xlsx.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { AssetClassService } from '../allocation/asset-class.service.js'
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
    const assetClasses = new AssetClassService(db)
    const transactions = new TransactionService(db, yahoo, exchangeRates, assetClasses)
    const dividends = new DividendService(db, transactions, exchangeRates)
    service = new CsvImportService(db, yahoo, transactions, dividends, assetClasses)
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

    it('linha com erro vem antes das válidas', async () => {
      await createAsset(db, 'PETR4')

      const rows = await service.parseCsvWithAssetLookup(
        [
          'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
          'PETR4\t99/99/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
        ].join('\n'),
      )

      expect(rows[0]?.error).toContain('Data inválida')
      expect(rows[1]?.error).toBeNull()
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

    it('ordena por status: desconhecido, novo e existente', async () => {
      await createAsset(db, 'VALE3')
      server.use(yahooChartBySymbol({ 'PETR3.SA': 'yahoo_chart_petr3.json' }))

      const csv = ['VALE3', 'PETR3', 'XXXX9']
        .map((ticker) => `${ticker}\t01/06/2024\tC\t1\t1\t0\tXP\t0\tBRL\t`)
        .join('\n')

      expect((await service.extractDistinctAssets(csv)).map((row) => row.ticker)).toEqual([
        'XXXX9',
        'PETR3',
        'VALE3',
      ])
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

    it('parseDividendCsv põe a linha com erro na frente', async () => {
      await createAsset(db, 'PETR4')

      const rows = await service.parseDividendCsv(
        [
          'PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP',
          'XXXX9\t01/03/2026\tDIVIDENDO\t1,00\t0,00\tBRL\tXP',
        ].join('\n'),
      )

      expect(rows.map((row) => row.ticker)).toEqual(['XXXX9', 'PETR4'])
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

  describe('parseB3MovimentacaoXlsx', () => {
    const XP = 'XP INVESTIMENTOS CCTVM S/A.'
    const linha = (movimento: string, produto: string, valor: string, data = '10/06/2026') => [
      'Credito',
      data,
      movimento,
      produto,
      XP,
      '100',
      '-',
      valor,
    ]

    it('separa provento de movimentação de custódia e ordena erro na frente', async () => {
      await createAsset(db, 'PETR4')

      const { rows, discarded } = await service.parseB3MovimentacaoXlsx(
        movimentacaoXlsx([
          linha('Rendimento', 'PETR4 - PAPEL DE TESTE', '500'),
          linha('Transferência', 'PETR4 - PAPEL DE TESTE', '-'),
          linha('Dividendo', 'XXXX9 - PAPEL DE FORA', '80'),
        ]),
      )

      expect(discarded).toBe(1)
      expect(rows.map((row) => [row.ticker, row.error === null])).toEqual([
        ['XXXX9', false],
        ['PETR4', true],
      ])
    })

    it('marca para ignorar o provento que já está no banco', async () => {
      await createAsset(db, 'PETR4')
      await service.batchImportDividends([
        {
          ticker: 'PETR4',
          date: '2026-06-10',
          type: 'RENDIMENTO',
          totalAmount: 500,
          taxWithheld: 0,
          currency: 'BRL',
          broker: 'XP',
          notes: 'CEI-Movimentação',
        },
      ])

      const { rows } = await service.parseB3MovimentacaoXlsx(
        movimentacaoXlsx([
          linha('Rendimento', 'PETR4 - PAPEL DE TESTE', '500'),
          linha('Rendimento', 'PETR4 - PAPEL DE TESTE', '500', '10/07/2026'),
        ]),
      )

      // Mesma data e valor → reimportação; o mês seguinte é provento novo.
      expect(rows.map((row) => [row.date, row.skipByDefault])).toEqual([
        ['2026-06-10', true],
        ['2026-07-10', false],
      ])
    })

    it('recusa planilha que não é o extrato da B3', async () => {
      await expect(
        service.parseB3MovimentacaoXlsx(buildXlsx([['Ticker', 'Data']])),
      ).rejects.toThrow(/extrato de Movimentação da B3/)
    })
  })
})
