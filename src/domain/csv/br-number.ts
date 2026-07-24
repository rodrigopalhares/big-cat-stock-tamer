/**
 * Número no formato brasileiro: `1.234,56`.
 * Porte de `parseBrazilianNumber` em CsvParsingService.kt.
 *
 * String em branco devolve 0 (coluna opcional vazia na planilha), não null.
 * Null significa "veio algo que não é número".
 */
export function parseBrazilianNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 0

  // Ponto é separador de milhar e some; vírgula é o decimal.
  const normalized = trimmed.replaceAll('.', '').replace(',', '.')
  const parsed = Number(normalized)

  // Number('') é 0 e Number(' ') também — já tratados acima.
  return Number.isFinite(parsed) ? parsed : null
}

/** Formata como a planilha espera: `2,31`. Usado ao anexar o IRRF às observações. */
export function formatBrazilianNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace('.', ',')
}
