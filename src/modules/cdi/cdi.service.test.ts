import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset, createTransaction } from '../../../tests/factories.js'
import { BCB_SGS, bcbSeries, HttpResponse, http, server } from '../../../tests/msw.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { isoDate } from '../../shared/iso-date.js'
import type { AssetPosition, PortfolioSummary } from '../portfolio/portfolio.schema.js'
import { CdiService } from './cdi.service.js'

const TODAY = isoDate('2024-06-30')

/** Só o que `compare` lê da posição; o resto do AssetPosition não entra na conta. */
function summaryWith(
  currentValue: number | null,
  flows: Array<{ date: string; value: number }>,
): PortfolioSummary {
  const position = {
    allCashFlowsBrl: flows.map((f) => ({ date: isoDate(f.date), value: f.value })),
  }
  return {
    totalInvested: 0,
    netContribution: 0,
    currentValue,
    realizedPnl: 0,
    unrealizedPnl: null,
    dividendPnl: 0,
    irrAnnual: null,
    irrMonthly: null,
    positions: [position as AssetPosition],
  }
}

describe('CdiService', () => {
  let db: TestDb
  let service: CdiService

  beforeAll(async () => {
    db = await createTestDb()
    service = new CdiService(db, new BcbClient())
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  async function seedRates(entries: Array<[string, number]>) {
    await db.cdiRate.createMany({
      data: entries.map(([date, rate]) => ({ date, rate })),
    })
  }

  describe('runBackfill', () => {
    it('sem transação não busca nada', async () => {
      server.use(bcbSeries([{ data: '01/06/2024', valor: '0,05' }]))

      expect(await service.runBackfill(TODAY)).toBe(0)
      expect(await db.cdiRate.count()).toBe(0)
    })

    it('grava a série a partir do primeiro aporte', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { date: '2024-06-03' })
      server.use(
        bcbSeries([
          { data: '03/06/2024', valor: '0,052531' },
          { data: '04/06/2024', valor: '0,052531' },
        ]),
      )

      expect(await service.runBackfill(TODAY)).toBe(2)

      const rows = await db.cdiRate.findMany({ orderBy: { date: 'asc' } })
      expect(rows.map((r) => r.date)).toEqual(['2024-06-03', '2024-06-04'])
      expect(rows[0]?.rate).toBeCloseTo(0.00052531, 10)
    })

    it('a primeira busca começa no primeiro aporte', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { date: '2024-06-03' })

      let requestUrl = ''
      server.use(
        http.get(BCB_SGS, ({ request }) => {
          requestUrl = decodeURIComponent(request.url)
          return HttpResponse.json([])
        }),
      )

      await service.runBackfill(TODAY)

      expect(requestUrl).toContain('dataInicial=03/06/2024')
    })

    it('retoma do dia seguinte ao último gravado', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { date: '2020-01-02' })
      await seedRates([['2024-06-10', 0.0005]])

      let requestUrl = ''
      server.use(
        http.get(BCB_SGS, ({ request }) => {
          requestUrl = decodeURIComponent(request.url)
          return HttpResponse.json([])
        }),
      )

      await service.runBackfill(TODAY)

      // Não volta a 2020: o que já está gravado não é buscado de novo.
      expect(requestUrl).toContain('dataInicial=11/06/2024')
    })

    it('rodar duas vezes não duplica nem muda a contagem', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { date: '2024-06-03' })
      server.use(bcbSeries([{ data: '03/06/2024', valor: '0,052531' }]))

      await service.runBackfill(TODAY)
      await service.runBackfill(TODAY)

      expect(await db.cdiRate.count()).toBe(1)
    })

    it('série já em dia não busca nada', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { date: '2024-06-03' })
      await seedRates([['2024-06-30', 0.0005]])

      expect(await service.runBackfill(TODAY)).toBe(0)
    })

    it('falha do BCB não apaga o que já existe', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { date: '2024-06-03' })
      await seedRates([['2024-06-10', 0.0005]])
      server.use(http.get(BCB_SGS, () => new HttpResponse(null, { status: 500 })))

      expect(await service.runBackfill(TODAY)).toBe(0)
      expect(await db.cdiRate.count()).toBe(1)
    })
  })

  describe('compare', () => {
    it('sem série gravada devolve null', async () => {
      expect(await service.compare(summaryWith(1000, [{ date: '2024-06-01', value: -1000 }]))).toBe(
        null,
      )
    })

    it('sem valor de mercado devolve null', async () => {
      await seedRates([['2024-06-01', 0.001]])

      expect(await service.compare(summaryWith(null, [{ date: '2024-06-01', value: -1000 }]))).toBe(
        null,
      )
    })

    it('sem fluxo nenhum devolve null', async () => {
      await seedRates([['2024-06-01', 0.001]])

      expect(await service.compare(summaryWith(1000, []))).toBe(null)
    })

    it('carteira acima do CDI dá diferença positiva', async () => {
      await seedRates([
        ['2024-06-01', 0.001],
        ['2024-06-02', 0.001],
      ])

      const result = await service.compare(
        summaryWith(1500, [{ date: '2024-06-01', value: -1000 }]),
        isoDate('2024-06-02'),
      )

      const sombra = 1000 * 1.001 ** 2
      expect(result?.cdiValue).toBeCloseTo(sombra, 6)
      expect(result?.difference).toBeCloseTo(1500 - sombra, 6)
      expect(result?.ratioOfCdi).toBeCloseTo(1500 / sombra, 6)
      expect(result?.lastRateDate).toBe('2024-06-02')
    })

    it('carteira abaixo do CDI dá diferença negativa', async () => {
      await seedRates([['2024-06-01', 0.001]])

      const result = await service.compare(
        summaryWith(500, [{ date: '2024-06-01', value: -1000 }]),
        isoDate('2024-06-01'),
      )

      expect(result?.difference).toBeLessThan(0)
      expect(result?.ratioOfCdi).toBeLessThan(1)
    })

    it('a TIR do CDI sai sobre o mesmo cronograma de fluxos', async () => {
      // Um ano de dias úteis à mesma taxa, para a TIR anual ser conferível.
      const rates: Array<[string, number]> = []
      for (let day = 0; day < 360; day++) {
        const date = new Date(Date.UTC(2023, 6, 1) + day * 86_400_000)
        rates.push([date.toISOString().slice(0, 10), 0.0004])
      }
      await seedRates(rates)

      const result = await service.compare(
        summaryWith(2000, [{ date: '2023-07-01', value: -1000 }]),
        isoDate('2024-06-25'),
      )

      // 360 dias a 0,04% compõem ~15,5% no período; a TIR anual fica na vizinhança.
      expect(result?.cdiIrrAnnual).toBeGreaterThan(0.14)
      expect(result?.cdiIrrAnnual).toBeLessThan(0.18)
    })

    it('junta os fluxos de todas as posições', async () => {
      await seedRates([['2024-06-01', 0.001]])
      const summary = summaryWith(3000, [])
      summary.positions = [
        { allCashFlowsBrl: [{ date: isoDate('2024-06-01'), value: -1000 }] },
        { allCashFlowsBrl: [{ date: isoDate('2024-06-01'), value: -2000 }] },
      ] as AssetPosition[]

      const result = await service.compare(summary, isoDate('2024-06-01'))

      expect(result?.cdiValue).toBeCloseTo(3000 * 1.001, 6)
    })

    it('a sombra não rende depois da última taxa', async () => {
      await seedRates([['2024-06-01', 0.001]])

      const result = await service.compare(
        summaryWith(1500, [{ date: '2024-06-01', value: -1000 }]),
        isoDate('2024-12-31'),
      )

      expect(result?.cdiValue).toBeCloseTo(1001, 6)
      expect(result?.lastRateDate).toBe('2024-06-01')
    })
  })
})
