import { type IsoDate, yearMonth } from '../shared/iso-date.js'

/**
 * Política de retenção de backup — funções puras, sem I/O.
 * Porte de src/main/kotlin/com/stocks/service/BackupRetention.kt.
 *
 * Decide o *nome* do snapshot de cada período e *quais* arquivos ficam fora da janela
 * que queremos manter. O carimbo no nome (yyyy-MM-dd no diário, yyyy-MM no mensal) ordena
 * lexicograficamente = cronologicamente, então um `sort()` simples basta para saber
 * quais são os mais recentes. O I/O (copiar, apagar) fica em src/infra/backup.ts.
 */

export const PREFIX = 'stocks-'
/** O conteúdo é gzip de um `.db`, não um zip — a extensão diz isso para o `gunzip` funcionar. */
export const SUFFIX = '.db.gz'

/** Nome do backup do dia: `stocks-yyyy-MM-dd.db.gz`. */
export function dailyName(date: IsoDate): string {
  return `${PREFIX}${date}${SUFFIX}`
}

/** Nome do backup do mês: `stocks-yyyy-MM.db.gz`. */
export function monthlyName(date: IsoDate): string {
  return `${PREFIX}${yearMonth(date)}${SUFFIX}`
}

/** Nomes a remover: tudo além dos [keep] mais recentes (`keep <= 0` → todos). */
export function excess(names: readonly string[], keep: number): string[] {
  const sorted = [...names].sort()
  if (keep <= 0) return sorted
  return sorted.slice(0, Math.max(0, sorted.length - keep))
}
