import type { AssetStatus } from './transaction-csv.js'

/**
 * Ordem das listas de revisão do import — a mesma nas três telas (ativos, transações e
 * proventos), para o que exige atenção estar sempre no mesmo lugar: o topo.
 */

/** Erro é status de linha, não de ativo — no CSV de proventos ele é o único que existe. */
export type ImportStatus = 'ERROR' | AssetStatus

/**
 * Record tipado de propósito: status novo não compila enquanto alguém não decidir a posição
 * dele na fila.
 */
const STATUS_RANK: Record<ImportStatus, number> = {
  ERROR: 0,
  UNKNOWN: 1,
  WILL_CREATE: 2,
  EXISTS: 3,
}

export type ImportOrderKey = {
  readonly status: ImportStatus
  readonly type: string
  readonly name: string
}

/**
 * Ordena por status, depois tipo e nome. Ordena no lugar e devolve o mesmo array.
 * `sort` é estável, então linha empatada mantém a ordem em que veio do CSV.
 */
export function sortByImportOrder<T>(rows: T[], key: (row: T) => ImportOrderKey): T[] {
  return rows.sort((a, b) => compare(key(a), key(b)))
}

function compare(a: ImportOrderKey, b: ImportOrderKey): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    a.type.localeCompare(b.type, 'pt-BR') ||
    a.name.localeCompare(b.name, 'pt-BR')
  )
}
