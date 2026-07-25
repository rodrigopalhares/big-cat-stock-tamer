import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import type { Db } from '../config/db.js'
import { dailyName, excess, monthlyName, PREFIX, SUFFIX } from '../domain/backup-retention.js'
import type { Logger } from '../integrations/http.js'
import { silentLogger } from '../integrations/http.js'
import { type IsoDate, today as todayIso } from '../shared/iso-date.js'

/**
 * Backup automático do banco: snapshot consistente + retenção.
 * Porte de src/main/kotlin/com/stocks/service/BackupService.kt.
 *
 * Usa `VACUUM INTO`, o equivalente exato do `BACKUP TO` do H2: cópia transacionalmente
 * consistente mesmo com a aplicação escrevendo — não é cópia ingênua de arquivo, que
 * poderia pegar o banco no meio de uma transação.
 *
 * Escreve num `.tmp` e só então renomeia, para que uma falha nunca deixe um arquivo
 * parcial parecendo backup bom. A política de retenção é pura ([backup-retention]);
 * aqui fica só o I/O.
 */

export type BackupOptions = {
  enabled: boolean
  dir: string
  dailyCopies: number
  monthlyCopies: number
  databaseUrl: string
  logger?: Logger
}

export class BackupService {
  private readonly logger: Logger

  constructor(
    private readonly db: Db,
    private readonly options: BackupOptions,
  ) {
    this.logger = options.logger ?? silentLogger
  }

  /** Garante que os backups diário e mensal de [today] existem, e rotaciona os antigos. */
  async ensureBackups(today: IsoDate = todayIso()): Promise<void> {
    if (!this.options.enabled) {
      this.logger.info('Backup desabilitado (APP_BACKUP_ENABLED=false)')
      return
    }
    if (this.isInMemory()) {
      this.logger.info('Banco em memória — nada a fazer')
      return
    }

    await this.ensure(join(this.options.dir, 'daily'), dailyName(today), this.options.dailyCopies)
    await this.ensure(
      join(this.options.dir, 'monthly'),
      monthlyName(today),
      this.options.monthlyCopies,
    )
  }

  /** Cria `folder/name` se faltar e rotaciona a pasta. */
  private async ensure(folder: string, name: string, keep: number): Promise<void> {
    const target = join(folder, name)
    if (!existsSync(target)) {
      await this.snapshot(target)
      this.logger.info(`Backup criado: ${target}`)
    }
    this.rotate(folder, keep)
  }

  /** Cópia consistente via VACUUM INTO, comprimida em seguida. */
  private async snapshot(target: string): Promise<void> {
    mkdirSync(join(target, '..'), { recursive: true })

    const raw = `${target}.db.tmp`
    const temp = `${target}.tmp`
    try {
      // VACUUM não roda dentro de transação — confirmado em docs/fase-0-spike.md §1.
      await this.db.$executeRawUnsafe(`VACUUM INTO '${sqlLiteral(raw)}'`)
      await pipeline(createReadStream(raw), createGzip(), createWriteStream(temp))
      renameSync(temp, target)
    } finally {
      rmSync(raw, { force: true })
      rmSync(temp, { force: true })
    }
  }

  /** Apaga os backups além dos [keep] mais recentes. */
  private rotate(folder: string, keep: number): void {
    if (!existsSync(folder)) return
    const names = readdirSync(folder).filter(
      (name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX),
    )
    for (const name of excess(names, keep)) {
      rmSync(join(folder, name), { force: true })
      this.logger.info(`Backup rotacionado (removido): ${name}`)
    }
  }

  /** Só faz sentido para banco em arquivo; em memória não há o que copiar. */
  private isInMemory(): boolean {
    return this.options.databaseUrl.includes(':memory:')
  }
}

/** Escapa o caminho para uso dentro de literal SQL. */
function sqlLiteral(path: string): string {
  return path.replaceAll("'", "''")
}
