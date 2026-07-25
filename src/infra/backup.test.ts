import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../tests/db.js'
import { PrismaClient } from '../generated/prisma/client.js'
import { isoDate } from '../shared/iso-date.js'
import { BackupService } from './backup.js'

// Porte de src/test/kotlin/com/stocks/service/BackupServiceTest.kt

describe('BackupService', () => {
  let dir: string
  let dbFile: string
  let db: TestDb

  const service = (overrides: Partial<ConstructorParameters<typeof BackupService>[1]> = {}) =>
    new BackupService(db, {
      enabled: true,
      dir: join(dir, 'backups'),
      dailyCopies: 7,
      monthlyCopies: 3,
      databaseUrl: `file:${dbFile}`,
      ...overrides,
    })

  const daily = () => join(dir, 'backups', 'daily')
  const monthly = () => join(dir, 'backups', 'monthly')
  const listing = (folder: string) => (existsSync(folder) ? readdirSync(folder).sort() : [])

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'backup-test-'))
    dbFile = join(dir, 'stocks.db')
    // Banco em arquivo de verdade — VACUUM INTO precisa de algo para copiar.
    db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbFile}` }) })
    await db.$executeRawUnsafe('CREATE TABLE assets (ticker TEXT PRIMARY KEY, name TEXT)')
    await db.$executeRawUnsafe("INSERT INTO assets VALUES ('PETR4', 'Petrobras')")
  })

  afterEach(async () => {
    await db.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  it('cria o backup diário e o mensal', async () => {
    await service().ensureBackups(isoDate('2026-06-09'))

    expect(listing(daily())).toEqual(['stocks-2026-06-09.db.gz'])
    expect(listing(monthly())).toEqual(['stocks-2026-06.db.gz'])
  })

  it('o backup contém o banco de verdade', async () => {
    await service().ensureBackups(isoDate('2026-06-09'))

    const compressed = readFileSync(join(daily(), 'stocks-2026-06-09.db.gz'))
    const contents = gunzipSync(compressed)

    // Cabeçalho de arquivo SQLite, e o dado gravado está lá dentro.
    expect(contents.subarray(0, 15).toString()).toBe('SQLite format 3')
    expect(contents.includes(Buffer.from('Petrobras'))).toBe(true)
  })

  it('é idempotente no mesmo dia', async () => {
    const backup = service()
    await backup.ensureBackups(isoDate('2026-06-09'))
    const first = readFileSync(join(daily(), 'stocks-2026-06-09.db.gz'))

    await db.$executeRawUnsafe("INSERT INTO assets VALUES ('VALE3', 'Vale')")
    await backup.ensureBackups(isoDate('2026-06-09'))

    expect(listing(daily())).toHaveLength(1)
    // Não reescreveu: o conteúdo é o mesmo de antes da nova linha.
    expect(readFileSync(join(daily(), 'stocks-2026-06-09.db.gz'))).toEqual(first)
  })

  it('rotaciona os diários mantendo a quantidade configurada', async () => {
    const backup = service({ dailyCopies: 3 })
    for (const day of ['05', '06', '07', '08', '09']) {
      await backup.ensureBackups(isoDate(`2026-06-${day}`))
    }

    expect(listing(daily())).toEqual([
      'stocks-2026-06-07.db.gz',
      'stocks-2026-06-08.db.gz',
      'stocks-2026-06-09.db.gz',
    ])
  })

  it('rotaciona os mensais mantendo a quantidade configurada', async () => {
    const backup = service({ monthlyCopies: 2 })
    for (const month of ['04', '05', '06', '07']) {
      await backup.ensureBackups(isoDate(`2026-${month}-01`))
    }

    expect(listing(monthly())).toEqual(['stocks-2026-06.db.gz', 'stocks-2026-07.db.gz'])
  })

  it('funciona com a aplicação segurando conexão aberta', async () => {
    // A conexão de `db` está aberta e com dado não lido — é o cenário de produção.
    await db.$executeRawUnsafe("INSERT INTO assets VALUES ('ITUB4', 'Itau')")

    await expect(service().ensureBackups(isoDate('2026-06-09'))).resolves.toBeUndefined()
    expect(listing(daily())).toHaveLength(1)
  })

  it('banco em memória é no-op', async () => {
    const memory = await createTestDb()
    const backup = new BackupService(memory, {
      enabled: true,
      dir: join(dir, 'backups'),
      dailyCopies: 7,
      monthlyCopies: 3,
      databaseUrl: ':memory:',
    })

    await backup.ensureBackups(isoDate('2026-06-09'))

    expect(existsSync(daily())).toBe(false)
    await memory.$disconnect()
  })

  it('desabilitado não faz nada', async () => {
    await service({ enabled: false }).ensureBackups(isoDate('2026-06-09'))

    expect(existsSync(daily())).toBe(false)
  })

  it('não deixa arquivo temporário para trás', async () => {
    await service().ensureBackups(isoDate('2026-06-09'))

    expect(listing(daily()).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('arquivo já existente com nome do dia não é sobrescrito', async () => {
    const backup = service()
    await backup.ensureBackups(isoDate('2026-06-09'))
    writeFileSync(join(daily(), 'stocks-2026-06-09.db.gz'), 'marcador')

    await backup.ensureBackups(isoDate('2026-06-09'))

    expect(readFileSync(join(daily(), 'stocks-2026-06-09.db.gz'), 'utf8')).toBe('marcador')
  })
})
