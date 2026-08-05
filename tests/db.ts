import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client.js'

/**
 * Banco de teste em memória.
 *
 * Cada arquivo de teste cria o seu, aplicando o SQL das migrations — isolamento total
 * sem arquivo temporário nem limpeza entre execuções. A fase 0 confirmou que o adapter
 * aceita `:memory:` (ver docs/fase-0-spike.md §4).
 *
 * Aplicar o SQL direto, em vez de chamar o CLI do Prisma por worker, evita subir um
 * processo por arquivo de teste — a diferença é de segundos na suíte inteira.
 */

const MIGRATIONS = join(import.meta.dirname, '..', 'prisma', 'migrations')

let cachedSchemaSql: string | null = null

function schemaSql(): string {
  if (cachedSchemaSql !== null) return cachedSchemaSql
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  cachedSchemaSql = dirs
    .map((dir) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'))
    .join('\n')
  return cachedSchemaSql
}

export type TestDb = PrismaClient

export async function createTestDb(): Promise<TestDb> {
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: ':memory:' }) })

  for (const statement of splitStatements(schemaSql())) {
    await prisma.$executeRawUnsafe(statement)
  }
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')

  return prisma
}

/** Apaga todos os dados respeitando a ordem das FKs, sem recriar o schema. */
export async function clearAllData(prisma: TestDb): Promise<void> {
  await prisma.$transaction([
    prisma.priceHistory.deleteMany(),
    prisma.monthlySnapshot.deleteMany(),
    prisma.dividend.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.brokerNote.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.assetClass.deleteMany(),
    prisma.exchangeRate.deleteMany(),
    prisma.benchmarkPrice.deleteMany(),
    prisma.riskMetric.deleteMany(),
    prisma.cdiRate.deleteMany(),
  ])
}

/** Separa os comandos do arquivo de migration, ignorando comentários. */
function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement !== '')
}
