import { fromBrazilianDate } from '../../shared/iso-date.js'
import {
  type Currency,
  DIVIDEND_TYPE_ALIASES,
  type DividendType,
  isCurrency,
} from '../constants.js'
import { parseBrazilianNumber } from './br-number.js'

/**
 * Parsing das linhas do CSV de proventos — puro, sem banco e sem rede.
 * Porte da parte pura de src/main/kotlin/com/stocks/service/DividendCsvParsingService.kt.
 *
 * Colunas esperadas, separadas por TAB:
 *   0 ticker · 1 data (dd/MM/yyyy) · 2 tipo · 3 valor total · 4 IR retido
 *   5 moeda · 6 corretora · 7 [ignorada] · 8 observações
 */

export type DividendCsvRow = {
  readonly rowIndex: number
  readonly ticker: string
  /** ISO quando a data é válida; caso contrário o texto original, com o erro preenchido. */
  readonly date: string
  readonly type: DividendType | string
  readonly totalAmount: number
  readonly taxWithheld: number
  readonly currency: Currency
  readonly broker: string
  readonly notes: string
  readonly error: string | null
}

const MIN_COLUMNS = 7

export function parseDividendCsvRows(
  rawCsv: string,
  existingTickers: ReadonlySet<string>,
): DividendCsvRow[] {
  const lines = rawCsv.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '')
  return lines.map((line, index) => parseSingleRow(index, line, existingTickers))
}

function parseSingleRow(
  index: number,
  line: string,
  existingTickers: ReadonlySet<string>,
): DividendCsvRow {
  const cols = line.split('\t')

  if (cols.length < MIN_COLUMNS) {
    return {
      rowIndex: index,
      ticker: column(cols, 0).trim().toUpperCase(),
      date: column(cols, 1).trim(),
      type: column(cols, 2).trim().toUpperCase(),
      totalAmount: 0,
      taxWithheld: 0,
      currency: 'BRL',
      broker: '',
      notes: '',
      error: `Colunas insuficientes (esperado pelo menos ${MIN_COLUMNS}, encontrado ${cols.length})`,
    }
  }

  const ticker = column(cols, 0).trim().toUpperCase()
  if (ticker === '') {
    return {
      rowIndex: index,
      ticker: '',
      date: column(cols, 1).trim(),
      type: column(cols, 2).trim().toUpperCase(),
      totalAmount: 0,
      taxWithheld: 0,
      currency: column(cols, 5, 'BRL').trim().toUpperCase() as Currency,
      broker: column(cols, 6).trim(),
      notes: column(cols, 8).trim(),
      error: 'Ticker vazio',
    }
  }

  const errors: string[] = []

  const rawDate = column(cols, 1).trim()
  const parsedDate = fromBrazilianDate(rawDate)
  if (parsedDate === null) errors.push(`Data inválida: ${rawDate}`)

  const rawType = column(cols, 2).trim().toUpperCase()
  const type = DIVIDEND_TYPE_ALIASES[rawType]
  if (type === undefined) errors.push(`Tipo desconhecido: ${column(cols, 2).trim()}`)

  const rawAmount = column(cols, 3)
  const totalAmount = parseBrazilianNumber(rawAmount)
  if (totalAmount === null) errors.push(`Valor inválido: ${rawAmount}`)
  if (totalAmount !== null && totalAmount <= 0) errors.push('Valor deve ser > 0')

  const taxWithheld = parseBrazilianNumber(column(cols, 4)) ?? 0
  if (taxWithheld < 0) errors.push('IR Retido não pode ser negativo')

  const rawCurrency = column(cols, 5).trim().toUpperCase()
  const currency: Currency = isCurrency(rawCurrency) ? rawCurrency : 'BRL'

  const broker = column(cols, 6).trim()
  // A coluna 7 é a "[ignorar]" da planilha.
  const notes = column(cols, 8).trim()

  if (!existingTickers.has(ticker)) errors.push(`Ativo não cadastrado: ${ticker}`)

  return {
    rowIndex: index,
    ticker,
    date: parsedDate ?? rawDate,
    type: type ?? rawType,
    totalAmount: totalAmount ?? 0,
    taxWithheld,
    currency,
    broker,
    notes,
    error: errors.length > 0 ? errors.join('; ') : null,
  }
}

function column(cols: readonly string[], index: number, fallback = ''): string {
  return cols[index] ?? fallback
}
