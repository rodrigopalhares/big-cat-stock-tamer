import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client.js'

/**
 * Dados de exemplo para desenvolvimento local.
 *
 * Não há banco de produção para migrar — o SQLite nasce vazio —, então sem isto não dá
 * para clicar nas telas. Rodar com `npx prisma db seed`.
 */

process.loadEnvFile('.env')

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env['DATABASE_URL'] ?? 'file:./data/stocks.db' }),
})

const ASSETS = [
  { ticker: 'PETR4', name: 'Petróleo Brasileiro S.A.', type: 'STOCK', yfTicker: 'PETR4.SA' },
  { ticker: 'VALE3', name: 'Vale S.A.', type: 'STOCK', yfTicker: 'VALE3.SA' },
  { ticker: 'HGLG11', name: 'CSHG Logística FII', type: 'REIT', yfTicker: 'HGLG11.SA' },
  { ticker: 'BOVA11', name: 'iShares Ibovespa', type: 'ETF', yfTicker: 'BOVA11.SA' },
  { ticker: 'AAPL', name: 'Apple Inc.', type: 'INTERNATIONAL', yfTicker: 'AAPL', currency: 'USD' },
]

async function main(): Promise<void> {
  for (const asset of ASSETS) {
    await prisma.asset.upsert({
      where: { ticker: asset.ticker },
      create: { currency: 'BRL', ...asset },
      update: {},
    })
  }

  const transactions = [
    { assetId: 'PETR4', quantity: 100, price: 32.5, date: '2024-01-15' },
    { assetId: 'PETR4', quantity: 50, price: 38.2, date: '2024-06-10' },
    { assetId: 'VALE3', quantity: 80, price: 62.0, date: '2024-02-20' },
    { assetId: 'HGLG11', quantity: 30, price: 158.4, date: '2024-03-05' },
    { assetId: 'BOVA11', quantity: 20, price: 112.7, date: '2024-04-12' },
  ]

  for (const tx of transactions) {
    const exists = await prisma.transaction.count({
      where: { assetId: tx.assetId, date: tx.date },
    })
    if (exists > 0) continue
    await prisma.transaction.create({
      data: { ...tx, type: 'BUY', fees: 5, priceBrl: tx.price, feesBrl: 5, currency: 'BRL' },
    })
  }

  const dividends = [
    { assetId: 'PETR4', date: '2024-05-20', totalAmount: 340.0, type: 'DIVIDENDO' },
    { assetId: 'HGLG11', date: '2024-04-15', totalAmount: 33.0, type: 'RENDIMENTO' },
    { assetId: 'VALE3', date: '2024-07-01', totalAmount: 180.0, taxWithheld: 27.0, type: 'JCP' },
  ]

  for (const dividend of dividends) {
    const exists = await prisma.dividend.count({
      where: { assetId: dividend.assetId, date: dividend.date },
    })
    if (exists > 0) continue
    const taxWithheld = dividend.taxWithheld ?? 0
    await prisma.dividend.create({
      data: {
        ...dividend,
        taxWithheld,
        totalAmountBrl: dividend.totalAmount,
        taxWithheldBrl: taxWithheld,
      },
    })
  }

  console.log(
    `Seed: ${await prisma.asset.count()} ativos, ` +
      `${await prisma.transaction.count()} transações, ` +
      `${await prisma.dividend.count()} proventos.`,
  )
}

await main()
await prisma.$disconnect()
