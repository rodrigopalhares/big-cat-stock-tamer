import { DEFAULT_ASSET_CLASSES } from '../src/domain/asset-class.js'
import type { Asset, AssetClass, Dividend, Transaction } from '../src/generated/prisma/client.js'
import type { TestDb } from './db.js'

/**
 * Construtores de dados de teste.
 * Porte de src/test/kotlin/com/stocks/TestDataBuilders.kt.
 */

export function createAsset(
  db: TestDb,
  ticker: string,
  overrides: Partial<Omit<Asset, 'ticker'>> = {},
): Promise<Asset> {
  return db.asset.create({
    data: {
      ticker,
      name: ticker,
      type: 'STOCK',
      currency: 'BRL',
      ...overrides,
    },
  })
}

export function createAssetClass(
  db: TestDb,
  name: string,
  overrides: Partial<Omit<AssetClass, 'id' | 'name'>> = {},
): Promise<AssetClass> {
  return db.assetClass.create({
    data: { name, targetPercent: 20, color: '#6c757d', ...overrides },
  })
}

/**
 * As 5 classes que a migration cria. O `clearAllData` de cada teste apaga o que veio da
 * migration, então quem depende da classificação padrão as recria aqui.
 */
export async function seedDefaultAssetClasses(db: TestDb): Promise<void> {
  for (const assetClass of DEFAULT_ASSET_CLASSES) {
    await db.assetClass.create({ data: { ...assetClass } })
  }
}

export function createTransaction(
  db: TestDb,
  ticker: string,
  overrides: Partial<Omit<Transaction, 'id' | 'assetId'>> = {},
): Promise<Transaction> {
  const price = overrides.price ?? 30
  const fees = overrides.fees ?? 0
  return db.transaction.create({
    data: {
      assetId: ticker,
      type: 'BUY',
      quantity: 10,
      price,
      fees,
      priceBrl: price,
      feesBrl: fees,
      date: '2024-01-15',
      ...overrides,
    },
  })
}

export function createDividend(
  db: TestDb,
  ticker: string,
  overrides: Partial<Omit<Dividend, 'id' | 'assetId'>> = {},
): Promise<Dividend> {
  const totalAmount = overrides.totalAmount ?? 100
  const taxWithheld = overrides.taxWithheld ?? 0
  return db.dividend.create({
    data: {
      assetId: ticker,
      type: 'DIVIDENDO',
      date: '2024-01-15',
      totalAmount,
      taxWithheld,
      totalAmountBrl: totalAmount,
      taxWithheldBrl: taxWithheld,
      ...overrides,
    },
  })
}

export function createPriceHistory(
  db: TestDb,
  ticker: string,
  date: string,
  close: number,
): Promise<unknown> {
  return db.priceHistory.create({ data: { assetId: ticker, date, close } })
}

export function createExchangeRate(
  db: TestDb,
  date: string,
  sellRate: number,
  fromCurrency = 'USD',
  toCurrency = 'BRL',
): Promise<unknown> {
  return db.exchangeRate.create({
    data: { date, fromCurrency, toCurrency, buyRate: sellRate, sellRate },
  })
}
