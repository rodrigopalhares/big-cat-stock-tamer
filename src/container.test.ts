import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../tests/db.js'
import { loadEnv } from './config/env.js'
import { buildContainer, type Container } from './container.js'

describe('container', () => {
  let db: TestDb
  let container: Container

  beforeAll(async () => {
    db = await createTestDb()
    container = buildContainer(db, loadEnv({ ...process.env, DATABASE_URL: ':memory:' }))
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('monta todos os services', () => {
    expect(Object.keys(container).sort()).toEqual([
      'assets',
      'bcb',
      'benchmarks',
      'csvImport',
      'dividends',
      'evolution',
      'exchangeRates',
      'portfolio',
      'priceHistory',
      'riskMetrics',
      'tesouro',
      'transactions',
      'yahoo',
    ])
  })

  it('os services compartilham a mesma conexão', async () => {
    await container.assets.create({ ticker: 'PETR4', currency: 'BRL', type: 'STOCK' })

    // Se cada service tivesse seu próprio banco, este lookup falharia.
    expect(await container.transactions.findOrCreateAsset('PETR4')).toMatchObject({
      ticker: 'PETR4',
    })
  })
})
