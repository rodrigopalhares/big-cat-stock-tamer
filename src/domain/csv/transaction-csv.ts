import { fromBrazilianDate } from '../../shared/iso-date.js'
import { transactionTypeMeta } from '../../shared/transaction-types.js'
import {
  type Currency,
  isCurrency,
  TRANSACTION_TYPE_ALIASES,
  type TransactionType,
} from '../constants.js'
import { formatBrazilianNumber, parseBrazilianNumber } from './br-number.js'

/**
 * Parsing das linhas do CSV de transações — puro, sem banco e sem rede.
 * Porte da parte pura de src/main/kotlin/com/stocks/service/CsvParsingService.kt.
 *
 * Colunas esperadas, separadas por TAB:
 *   0 ticker · 1 data (dd/MM/yyyy) · 2 tipo (C/V/B/D/A/R.CAP) · 3 quantidade
 *   4 preço unitário · 5 taxas · 6 corretora · 7 IRRF · 8 moeda · 9 observações
 *
 * Nos eventos societários a quantidade é o delta de ações: B(onificação) e D(esdobramento)
 * somam, A(grupamento) subtrai. A coluna de preço só é lida na bonificação, como custo
 * unitário atribuído — nos outros dois o service zera preço e taxas.
 *
 * R.CAP é a exceção: a quantidade é a base de ações que recebeu a devolução (a posição não
 * muda) e o preço é o valor devolvido por ação, que abate o custo.
 */

export type AssetStatus = 'EXISTS' | 'WILL_CREATE' | 'UNKNOWN'

export type CsvRow = {
  readonly rowIndex: number
  readonly ticker: string
  /** ISO quando a data é válida; caso contrário o texto original, com o erro preenchido. */
  readonly date: string
  readonly type: TransactionType | string
  readonly quantity: number
  readonly price: number
  readonly fees: number
  readonly broker: string
  readonly notes: string
  readonly currency: Currency
  readonly assetStatus: AssetStatus
  readonly error: string | null
}

const MIN_COLUMNS = 7

/**
 * Converte o texto colado em linhas estruturadas.
 *
 * [assetInfoResolver] é chamado no máximo uma vez por ticker desconhecido — resolver é
 * caro (bate no Yahoo), então a deduplicação acontece antes.
 */
export function parseCsvRows(
  rawCsv: string,
  existingTickers: ReadonlySet<string>,
  assetInfoResolver: (ticker: string) => AssetStatus,
): CsvRow[] {
  const lines = splitLines(rawCsv)
  if (lines.length === 0) return []

  const allTickers = new Set(
    lines.map((line) => column(line.split('\t'), 0).trim().toUpperCase()).filter((t) => t !== ''),
  )

  const resolved = new Map<string, AssetStatus>()
  for (const ticker of allTickers) {
    if (!existingTickers.has(ticker)) resolved.set(ticker, assetInfoResolver(ticker))
  }

  return lines.map((line, index) => parseSingleRow(index, line, existingTickers, resolved))
}

/** Tickers distintos do CSV, na ordem em que aparecem. */
export function extractDistinctTickers(rawCsv: string): string[] {
  const seen = new Set<string>()
  for (const line of splitLines(rawCsv)) {
    const ticker = column(line.split('\t'), 0).trim().toUpperCase()
    if (ticker !== '') seen.add(ticker)
  }
  return [...seen]
}

function parseSingleRow(
  index: number,
  line: string,
  existingTickers: ReadonlySet<string>,
  resolved: ReadonlyMap<string, AssetStatus>,
): CsvRow {
  const cols = line.split('\t')

  if (cols.length < MIN_COLUMNS) {
    return {
      rowIndex: index,
      ticker: column(cols, 0).trim().toUpperCase(),
      date: column(cols, 1).trim(),
      type: column(cols, 2).trim().toUpperCase(),
      quantity: 0,
      price: 0,
      fees: 0,
      broker: '',
      notes: '',
      currency: 'BRL',
      assetStatus: 'UNKNOWN',
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
      quantity: 0,
      price: 0,
      fees: 0,
      broker: column(cols, 6).trim(),
      notes: column(cols, 9).trim(),
      currency: column(cols, 8, 'BRL').trim().toUpperCase() as Currency,
      assetStatus: 'UNKNOWN',
      error: 'Ticker vazio',
    }
  }

  const errors: string[] = []

  const rawDate = column(cols, 1).trim()
  const parsedDate = fromBrazilianDate(rawDate)
  if (parsedDate === null) errors.push(`Data inválida: ${rawDate}`)

  const rawType = column(cols, 2).trim().toUpperCase()
  const type = normalizeType(rawType)
  if (type === null) errors.push(`Tipo inválido: ${rawType} (esperado C, V, B, D, A ou R.CAP)`)

  const rawQuantity = column(cols, 3)
  const quantity = parseBrazilianNumber(rawQuantity)
  if (quantity === null) errors.push(`Quantidade inválida: ${rawQuantity}`)
  const absQuantity = Math.abs(quantity ?? 0)
  if (quantity !== null && absQuantity <= 0) errors.push('Quantidade deve ser > 0')

  const rawPrice = column(cols, 4)
  const price = parseBrazilianNumber(rawPrice)
  if (price === null) errors.push(`Preço inválido: ${rawPrice}`)
  if (price !== null && price < 0) errors.push('Preço deve ser >= 0')

  const taxes = parseBrazilianNumber(column(cols, 5)) ?? 0
  const broker = column(cols, 6).trim()
  const irrf = parseBrazilianNumber(column(cols, 7)) ?? 0

  const rawCurrency = column(cols, 8, 'BRL').trim().toUpperCase()
  const currency: Currency = isCurrency(rawCurrency) ? rawCurrency : 'BRL'

  const rawNotes = column(cols, 9).trim()
  const notes =
    irrf > 0
      ? `${rawNotes}${rawNotes === '' ? '' : ' '}IRRF: ${formatBrazilianNumber(irrf)}`
      : rawNotes

  const assetStatus: AssetStatus = existingTickers.has(ticker)
    ? 'EXISTS'
    : (resolved.get(ticker) ?? 'UNKNOWN')

  return {
    rowIndex: index,
    ticker,
    date: parsedDate ?? rawDate,
    type: type ?? rawType,
    quantity: (type === null ? 1 : transactionTypeMeta(type).sign) * absQuantity,
    price: price ?? 0,
    fees: taxes + irrf,
    broker,
    notes,
    currency,
    assetStatus,
    error: errors.length > 0 ? errors.join('; ') : null,
  }
}

function normalizeType(raw: string): TransactionType | null {
  return TRANSACTION_TYPE_ALIASES[raw] ?? null
}

/** Equivale ao `String.lines().filter { it.isNotBlank() }` do Kotlin. */
function splitLines(raw: string): string[] {
  return raw.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '')
}

function column(cols: readonly string[], index: number, fallback = ''): string {
  return cols[index] ?? fallback
}
