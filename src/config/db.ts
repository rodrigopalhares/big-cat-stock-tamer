import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client.js'
import type { Env } from './env.js'

export type Db = PrismaClient

/**
 * Cria o client do Prisma e aplica os PRAGMAs do SQLite.
 *
 * `journal_mode` NÃO é WAL por padrão (vem `delete`) e `foreign_keys` é setado
 * explicitamente para o ON DELETE CASCADE das 4 FKs não depender de default do driver.
 * Verificado em docs/fase-0-spike.md §4.
 */
export async function createDb(env: Pick<Env, 'DATABASE_URL'>): Promise<Db> {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: env.DATABASE_URL }),
  })
  await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL')
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  return prisma
}
