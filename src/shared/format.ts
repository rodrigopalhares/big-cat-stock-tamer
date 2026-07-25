import { type IsoDate, toBrazilianDate, yearMonth } from './iso-date.js'

/**
 * Formatação para exibição, em pt-BR.
 *
 * Substitui o `#numbers.formatDecimal(x, 1, 2)` dos templates *e* o `static/js/format.js`,
 * que percorria todos os nós de texto da página inserindo separador de milhar por regex —
 * o Thymeleaf não os inseria e o hack no cliente compensava. Aqui sai certo da origem.
 */

const decimalFormatters = new Map<number, Intl.NumberFormat>()

function formatter(digits: number): Intl.NumberFormat {
  const cached = decimalFormatters.get(digits)
  if (cached !== undefined) return cached
  const created = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  decimalFormatters.set(digits, created)
  return created
}

/** `1234.5` → `1.234,50`. */
export function decimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return formatter(digits).format(value)
}

/** Quantidade de cotas: até 4 casas, sem zeros à direita desnecessários. */
export function quantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? formatter(0).format(value) : decimal(value, 4)
}

/** `1234.5, 'BRL'` → `R$ 1.234,50`. */
export function money(value: number | null | undefined, currency = 'BRL'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${currencySymbol(currency)} ${decimal(value, 2)}`
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'USD':
      return 'US$'
    case 'EUR':
      return '€'
    default:
      return 'R$'
  }
}

/** `0.1425` → `14,25%`. */
export function percent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${decimal(value * 100, digits)}%`
}

/** `2024-01-15` → `15/01/2024`. */
export function date(value: IsoDate | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return toBrazilianDate(value as IsoDate)
}

/** `2024-01-15` → `01/2024`. */
export function monthLabel(value: IsoDate | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const [year, month] = yearMonth(value as IsoDate).split('-') as [string, string]
  return `${month}/${year}`
}

/** Classe do Bootstrap conforme o sinal — verde no lucro, vermelho no prejuízo. */
export function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-secondary'
  if (value > 0) return 'text-success'
  if (value < 0) return 'text-danger'
  return 'text-secondary'
}
