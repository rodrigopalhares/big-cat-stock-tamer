import { fromBrazilianDate, type IsoDate, maxDate } from '../../shared/iso-date.js'

/**
 * Parsing do CSV do Tesouro Transparente — puro, sem rede.
 * Porte de `parseTdCsv` em src/main/kotlin/com/stocks/service/QuoteService.kt.
 *
 * Separador `;`, cabeçalho na primeira linha, datas em dd/MM/yyyy e decimais com vírgula:
 *   Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;...;PU Compra Manha;...
 */

export type TesouroRow = {
  readonly tipoTitulo: string
  readonly dataVencimento: string
  readonly dataBase: IsoDate | null
  readonly puCompraManha: number | null
}

export function parseTesouroCsv(csvText: string): TesouroRow[] {
  const lines = csvText.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '')
  const headerLine = lines[0]
  if (headerLine === undefined) return []

  const header = headerLine.split(';').map((h) => h.toLowerCase().trim())
  const idx = {
    tipoTitulo: header.indexOf('tipo titulo'),
    dataVencimento: header.indexOf('data vencimento'),
    dataBase: header.indexOf('data base'),
    puCompraManha: header.indexOf('pu compra manha'),
  }

  const rows: TesouroRow[] = []
  for (const line of lines.slice(1)) {
    const cols = line.split(';')
    const at = (i: number): string => (i >= 0 ? (cols[i] ?? '') : '')

    const rawPu = at(idx.puCompraManha).replace(',', '.')
    const pu = rawPu.trim() === '' ? null : Number(rawPu)

    rows.push({
      tipoTitulo: at(idx.tipoTitulo).trim(),
      dataVencimento: at(idx.dataVencimento).trim(),
      dataBase: fromBrazilianDate(at(idx.dataBase)),
      puCompraManha: pu !== null && Number.isFinite(pu) ? pu : null,
    })
  }
  return rows
}

/**
 * O ticker do Tesouro é `<tipo>;<vencimento>` — por exemplo `Tesouro Selic;01/03/2029`.
 * Null quando não segue esse formato.
 */
export function splitTesouroTicker(ticker: string): { title: string; maturity: string } | null {
  const separator = ticker.indexOf(';')
  if (separator < 0) return null
  return { title: ticker.slice(0, separator), maturity: ticker.slice(separator + 1) }
}

export function rowsForTicker(rows: readonly TesouroRow[], ticker: string): TesouroRow[] {
  const parts = splitTesouroTicker(ticker)
  if (parts === null) return []
  return rows.filter((r) => r.tipoTitulo === parts.title && r.dataVencimento === parts.maturity)
}

/** Só as linhas da data-base mais recente — é o que dá a cotação "de hoje". */
export function latestRows(rows: readonly TesouroRow[]): TesouroRow[] {
  const dates = rows.map((r) => r.dataBase).filter((d): d is IsoDate => d !== null)
  const latest = maxDate(dates)
  if (latest === null) return []
  return rows.filter((r) => r.dataBase === latest)
}
