/**
 * Substitui `java.time.LocalDate`: uma data de calendário, sem hora e sem fuso.
 *
 * Representada como `YYYY-MM-DD`, que ordena e compara lexicograficamente na mesma
 * ordem cronológica — em SQL, em JS e em JSON. O tipo é *branded* para que uma string
 * qualquer não passe por data sem antes ser validada.
 *
 * Toda aritmética interna usa `Date.UTC`, então nenhuma operação depende do fuso do
 * processo. O tipo `Date` do JS nunca escapa deste módulo.
 *
 * Ver docs/migracao-typescript.md §3.1.
 */

declare const isoDateBrand: unique symbol
export type IsoDate = string & { readonly [isoDateBrand]: 'IsoDate' }

/** `YYYY-MM`, equivalente ao `java.time.YearMonth`. */
declare const yearMonthBrand: unique symbol
export type YearMonth = string & { readonly [yearMonthBrand]: 'YearMonth' }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const YEAR_MONTH = /^\d{4}-\d{2}$/

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false
  // Rejeita 2024-02-30 e afins: o round-trip só bate em data que existe.
  return toUtc(value).toISOString().slice(0, 10) === value
}

/** Valida e converte. Lança se a string não for uma data de calendário válida. */
export function isoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Data ISO inválida: "${value}"`)
  return value
}

export function isoDateOrNull(value: string): IsoDate | null {
  return isIsoDate(value) ? value : null
}

/** Monta a partir das partes. `month` é 1-12, como em `LocalDate.of`. */
export function fromParts(year: number, month: number, day: number): IsoDate {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return isoDate(`${pad(year, 4)}-${pad(month)}-${pad(day)}`)
}

/** Data de hoje no fuso informado (default `America/Sao_Paulo`, o do scheduler). */
export function today(timeZone = 'America/Sao_Paulo'): IsoDate {
  // 'en-CA' formata como YYYY-MM-DD.
  return isoDate(new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()))
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10) as IsoDate
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, day] = split(date)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  // Clampa o dia, como o java.time faz: 31/01 + 1 mês = 28/02 (ou 29 em bissexto).
  return fromParts(year, month, Math.min(day, daysInMonth(year, month)))
}

/** Dias de [from] até [to]; negativo se [to] for anterior. Equivale a `ChronoUnit.DAYS.between`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)
}

/** Comparador para `sort`: negativo, zero ou positivo. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function minDate(dates: readonly IsoDate[]): IsoDate | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (a <= b ? a : b))
}

export function maxDate(dates: readonly IsoDate[]): IsoDate | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (a >= b ? a : b))
}

// ------------------------------------------------------------------ YearMonth

export function yearMonth(date: IsoDate): YearMonth {
  return date.slice(0, 7) as YearMonth
}

export function isYearMonth(value: string): value is YearMonth {
  if (!YEAR_MONTH.test(value)) return false
  const month = Number(value.slice(5, 7))
  return month >= 1 && month <= 12
}

export function toYearMonth(value: string): YearMonth {
  if (!isYearMonth(value)) throw new RangeError(`YearMonth inválido: "${value}"`)
  return value
}

/** Primeiro dia do mês — o `atDay(1)` do `YearMonth`. */
export function firstDayOf(ym: YearMonth): IsoDate {
  return `${ym}-01` as IsoDate
}

/** Último dia do mês — o `atEndOfMonth()`. */
export function lastDayOf(ym: YearMonth): IsoDate {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return fromParts(y, m, daysInMonth(y, m))
}

export function addMonthsToYearMonth(ym: YearMonth, months: number): YearMonth {
  return yearMonth(addMonths(firstDayOf(ym), months))
}

/** Meses de [from] até [to], inclusive nas duas pontas. */
export function monthsBetweenInclusive(from: YearMonth, to: YearMonth): YearMonth[] {
  const out: YearMonth[] = []
  let current = from
  while (current <= to) {
    out.push(current)
    current = addMonthsToYearMonth(current, 1)
  }
  return out
}

// ---------------------------------------------------------- formato brasileiro

const BR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/

/** Converte `dd/MM/yyyy` (planilha de corretora) em ISO. Null se não casar. */
export function fromBrazilianDate(value: string): IsoDate | null {
  const match = BR_DATE.exec(value.trim())
  if (!match) return null
  const [, day, month, year] = match as unknown as [string, string, string, string]
  return isoDateOrNull(`${year}-${month}-${day}`)
}

/** Converte ISO em `dd/MM/yyyy`, para exibição. */
export function toBrazilianDate(date: IsoDate): string {
  const [y, m, d] = split(date)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

// ------------------------------------------------------------------- internos

function toUtc(value: string): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
}

function split(date: IsoDate): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number]
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
