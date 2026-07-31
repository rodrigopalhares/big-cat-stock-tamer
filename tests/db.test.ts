import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from './db.js'

describe('banco de teste', () => {
  let db: TestDb

  beforeAll(async () => {
    db = await createTestDb()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('cria as 10 tabelas', async () => {
    const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    expect(tables.map((t) => t.name)).toEqual([
      'asset_classes',
      'assets',
      'benchmark_prices',
      'broker_notes',
      'dividends',
      'exchange_rates',
      'monthly_snapshots',
      'price_history',
      'risk_metrics',
      'transactions',
    ])
  })

  it('a migration já traz as 5 classes de alocação', async () => {
    const classes = await db.assetClass.findMany({ orderBy: { name: 'asc' } })
    expect(classes.map((c) => c.name)).toEqual([
      'Ações',
      'Crypto',
      'Fii',
      'Internacional',
      'Renda Fixa',
    ])
    expect(classes.every((c) => c.targetPercent === 20)).toBe(true)
  })

  it('grava e lê um ativo', async () => {
    await db.asset.create({ data: { ticker: 'PETR4', name: 'Petrobras' } })
    expect(await db.asset.findUnique({ where: { ticker: 'PETR4' } })).toMatchObject({
      ticker: 'PETR4',
      name: 'Petrobras',
      currency: 'BRL',
      quantity: 0,
    })
  })

  it('aplica ON DELETE CASCADE', async () => {
    await db.asset.create({
      data: {
        ticker: 'VALE3',
        transactions: { create: [{ type: 'BUY', quantity: 1, price: 1, date: '2024-01-01' }] },
      },
    })
    await db.asset.delete({ where: { ticker: 'VALE3' } })
    expect(await db.transaction.count({ where: { assetId: 'VALE3' } })).toBe(0)
  })

  it('respeita a constraint única de price_history', async () => {
    await db.asset.create({ data: { ticker: 'ITUB4' } })
    await db.priceHistory.create({ data: { assetId: 'ITUB4', date: '2024-01-01', close: 30 } })
    await expect(
      db.priceHistory.create({ data: { assetId: 'ITUB4', date: '2024-01-01', close: 31 } }),
    ).rejects.toThrow()
  })

  it('clearAllData esvazia tudo', async () => {
    await clearAllData(db)
    expect(await db.asset.count()).toBe(0)
    expect(await db.transaction.count()).toBe(0)
    expect(await db.priceHistory.count()).toBe(0)
  })
})
