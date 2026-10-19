import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createExchangeRate, createTransaction } from '../../../tests/factories.js'
import { BCB_PTAX, bcbPtax, HttpResponse, http, server } from '../../../tests/msw.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { ExchangeRateService } from './exchange-rate.service.js'

// Porte de src/test/kotlin/com/stocks/service/ExchangeRateServiceTest.kt

describe('ExchangeRateService', () => {
  let db: TestDb
  let service: ExchangeRateService

  beforeAll(async () => {
    db = await createTestDb()
    service = new ExchangeRateService(db, new BcbClient())
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('getRate', () => {
    it('mesma moeda devolve 1', async () => {
      expect(await service.getRate('BRL', 'BRL', isoDate('2024-01-15'))).toBe(1)
    })

    it('devolve a taxa gravada quando existe', async () => {
      await createExchangeRate(db, '2024-01-15', 5.5)
      expect(await service.getRate('USD', 'BRL', isoDate('2024-01-15'))).toBeCloseTo(5.5, 4)
    })

    it('cai para a taxa mais próxima quando o BCB não devolve nada', async () => {
      server.use(http.get(BCB_PTAX, () => HttpResponse.json({ value: [] })))
      await createExchangeRate(db, '2024-01-10', 5.1)

      expect(await service.getRate('USD', 'BRL', isoDate('2024-06-01'))).toBeCloseTo(5.1, 4)
    })

    it('lança quando não há taxa nenhuma e o BCB não devolve nada', async () => {
      server.use(http.get(BCB_PTAX, () => HttpResponse.json({ value: [] })))

      await expect(service.getRate('USD', 'BRL', isoDate('2024-01-15'))).rejects.toThrow(
        /Sem cotação/,
      )
    })

    it('faz backfill do BCB e grava no banco', async () => {
      server.use(bcbPtax('bcb_ptax_period.json'))
      await db.asset.create({ data: { ticker: 'AAPL', currency: 'USD' } })
      await createTransaction(db, 'AAPL', { date: '2025-03-05' })

      const rate = await service.getRate('USD', 'BRL', isoDate('2025-03-05'))

      expect(rate).toBeCloseTo(5.7914, 4)
      expect(await db.exchangeRate.count()).toBeGreaterThan(0)
    })

    it('erro da API do BCB não impede o fallback', async () => {
      server.use(http.get(BCB_PTAX, () => new HttpResponse(null, { status: 500 })))
      await createExchangeRate(db, '2024-01-10', 5.1)

      expect(await service.getRate('USD', 'BRL', isoDate('2024-06-01'))).toBeCloseTo(5.1, 4)
    })
  })

  describe('getLatestRate', () => {
    it('devolve a taxa mais recente gravada sem chamar o BCB', async () => {
      // Sem handler do BCB: se chamasse a API, o teste falharia.
      await createExchangeRate(db, '2024-01-10', 5.1)
      await createExchangeRate(db, '2024-03-20', 5.9)

      expect(await service.getLatestRate('USD')).toBeCloseTo(5.9, 4)
    })

    it('sem taxa nenhuma gravada, busca no BCB', async () => {
      server.use(bcbPtax('bcb_ptax_period.json'))
      await db.asset.create({ data: { ticker: 'AAPL', currency: 'USD' } })
      await createTransaction(db, 'AAPL', { date: '2025-03-05' })

      expect(await service.getLatestRate('USD')).toBeGreaterThan(0)
      expect(await db.exchangeRate.count()).toBeGreaterThan(0)
    })

    it('mesma moeda devolve 1', async () => {
      expect(await service.getLatestRate('BRL')).toBe(1)
    })
  })

  describe('findRate', () => {
    it('devolve null quando não está no banco', async () => {
      expect(await service.findRate('USD', 'BRL', isoDate('2024-01-15'))).toBeNull()
    })

    it('devolve a taxa de venda, não a de compra', async () => {
      await db.exchangeRate.create({
        data: {
          date: '2024-01-15',
          fromCurrency: 'USD',
          toCurrency: 'BRL',
          buyRate: 5.0,
          sellRate: 5.5,
        },
      })
      expect(await service.findRate('USD', 'BRL', isoDate('2024-01-15'))).toBeCloseTo(5.5, 4)
    })
  })

  describe('findClosestRate', () => {
    it('devolve a mais recente', async () => {
      await createExchangeRate(db, '2024-01-10', 5.1)
      await createExchangeRate(db, '2024-03-20', 5.9)
      await createExchangeRate(db, '2024-02-15', 5.5)

      expect(await service.findClosestRate('USD', 'BRL', isoDate('2024-06-01'))).toBeCloseTo(5.9, 4)
    })

    it('devolve null quando não há nenhuma', async () => {
      expect(await service.findClosestRate('USD', 'BRL', isoDate('2024-01-15'))).toBeNull()
    })
  })

  describe('upsertRate', () => {
    it('insere taxa nova', async () => {
      await service.upsertRate(isoDate('2024-01-15'), 'USD', 'BRL', 5.0, 5.1)

      expect(await db.exchangeRate.count()).toBe(1)
      expect(await service.findRate('USD', 'BRL', isoDate('2024-01-15'))).toBeCloseTo(5.1, 4)
    })

    it('atualiza taxa existente sem duplicar', async () => {
      await service.upsertRate(isoDate('2024-01-15'), 'USD', 'BRL', 5.0, 5.1)
      await service.upsertRate(isoDate('2024-01-15'), 'USD', 'BRL', 6.0, 6.1)

      expect(await db.exchangeRate.count()).toBe(1)
      expect(await service.findRate('USD', 'BRL', isoDate('2024-01-15'))).toBeCloseTo(6.1, 4)
    })
  })

  describe('backfillFromBcb', () => {
    it('preenche os dias sem cotação repetindo a última conhecida', async () => {
      // O fixture tem cotações em 05, 06 e 07 de março; 08 e 09 são fim de semana.
      server.use(bcbPtax('bcb_ptax_period.json'))
      await db.asset.create({ data: { ticker: 'AAPL', currency: 'USD' } })
      await createTransaction(db, 'AAPL', { date: '2025-03-05' })

      await service.backfillFromBcb('USD', 'BRL')

      const stored = await db.exchangeRate.findMany({ orderBy: { date: 'asc' } })
      expect(stored.length).toBeGreaterThan(3)
      // Nenhum dia do intervalo fica sem taxa.
      expect(stored.every((r) => r.sellRate > 0)).toBe(true)
    })

    /** A data inicial que o backfill pediu ao BCB, no formato da URL (`'MM-dd-yyyy'`). */
    async function requestedStart(): Promise<string | null> {
      let start: string | null = null
      server.use(
        http.get(BCB_PTAX, ({ request }) => {
          start = new URL(request.url).searchParams.get('@dataInicial')
          return HttpResponse.json({ value: [] })
        }),
      )
      await service.backfillFromBcb('USD', 'BRL')
      return start
    }

    it('retoma de uma semana antes da última taxa gravada', async () => {
      // Recomeçar da transação mais antiga regravava a série inteira todo dia.
      await db.asset.create({ data: { ticker: 'AAPL', currency: 'USD' } })
      await createTransaction(db, 'AAPL', { date: '2020-01-02' })
      await createExchangeRate(db, '2020-01-02', 4.0)
      await createExchangeRate(db, '2025-03-10', 5.7)

      expect(await requestedStart()).toBe("'03-03-2025'")
    })

    it('sem taxa gravada, começa da transação mais antiga', async () => {
      await db.asset.create({ data: { ticker: 'AAPL', currency: 'USD' } })
      await createTransaction(db, 'AAPL', { date: '2020-01-02' })

      expect(await requestedStart()).toBe("'01-02-2020'")
    })

    it('transação anterior ao começo da série refaz desde ela', async () => {
      await db.asset.create({ data: { ticker: 'AAPL', currency: 'USD' } })
      await createTransaction(db, 'AAPL', { date: '2019-06-03' })
      await createExchangeRate(db, '2020-01-02', 4.0)
      await createExchangeRate(db, '2025-03-10', 5.7)

      expect(await requestedStart()).toBe("'06-03-2019'")
    })

    it('não grava nada quando o BCB devolve lista vazia', async () => {
      server.use(http.get(BCB_PTAX, () => HttpResponse.json({ value: [] })))

      await service.backfillFromBcb('USD', 'BRL')

      expect(await db.exchangeRate.count()).toBe(0)
    })
  })
})
