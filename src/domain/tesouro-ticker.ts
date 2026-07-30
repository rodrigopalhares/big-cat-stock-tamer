import type { TesouroRow } from './csv/tesouro-csv.js'

/**
 * Tradução entre o código curto do ativo (`TD:IPCA2026`) e o código do CSV do Tesouro
 * Transparente (`Tesouro IPCA+;15/08/2026`). Puro — recebe as linhas já baixadas.
 *
 * O código do CSV não cabe no campo ticker, que é a chave primária do ativo e aparece em
 * tabela, gráfico e URL. Por isso o ativo é cadastrado pelo código curto e o código longo
 * fica em `yfTicker`, que é o que os clientes de cotação consultam.
 */

export const TESOURO_PREFIX = 'TD:'

/**
 * Código curto → nome do título no CSV.
 *
 * O sufixo `J` marca "com Juros Semestrais": sem ele, `IPCA` é o Tesouro IPCA+ puro
 * (NTN-B Principal). Os dois existem no mesmo vencimento com PU bem diferente — em
 * 15/05/2035 o principal vale ~2.400 e o de juros semestrais ~4.200 — então a distinção
 * não é cosmética.
 */
const SHORT_CODE_TITLES: ReadonlyMap<string, string> = new Map([
  ['SELIC', 'Tesouro Selic'],
  ['IPCA', 'Tesouro IPCA+'],
  ['IPCAJ', 'Tesouro IPCA+ com Juros Semestrais'],
  ['PRE', 'Tesouro Prefixado'],
  ['PREJ', 'Tesouro Prefixado com Juros Semestrais'],
  // O IGPM+ só existiu com juros semestrais, então não precisa do sufixo para desambiguar.
  ['IGPM', 'Tesouro IGPM+ com Juros Semestrais'],
  ['EDUCA', 'Tesouro Educa+'],
  ['RENDA', 'Tesouro Renda+ Aposentadoria Extra'],
])

/** Os códigos aceitos, para montar mensagem de erro e documentação. */
export const TESOURO_SHORT_CODES: readonly string[] = [...SHORT_CODE_TITLES.keys()]

export type TesouroShortCode = {
  /** Nome do título como aparece na coluna "Tipo Titulo" do CSV. */
  readonly title: string
  /** Ano de vencimento, com quatro dígitos. */
  readonly year: string
}

export type TesouroResolution = {
  /** Código do CSV, no formato `<título>;<dd/MM/yyyy>` — é o que vai para `yfTicker`. */
  readonly code: string
  readonly title: string
  readonly maturity: string
  /** Outros vencimentos do mesmo título no mesmo ano, quando o ano não é suficiente. */
  readonly alternatives: readonly string[]
}

/** Reconhece os dois formatos: o código curto do ativo e o código longo do CSV. */
export function isTesouroTicker(ticker: string): boolean {
  return ticker.includes(';') || ticker.trim().toUpperCase().startsWith(TESOURO_PREFIX)
}

/**
 * `TD:IPCA2026` → título "Tesouro IPCA+" vencendo em 2026.
 * Null quando o prefixo não está lá, o código não é conhecido ou o ano não são 4 dígitos.
 */
export function parseTesouroShortCode(ticker: string): TesouroShortCode | null {
  const normalized = ticker.trim().toUpperCase()
  if (!normalized.startsWith(TESOURO_PREFIX)) return null

  const rest = normalized.slice(TESOURO_PREFIX.length)
  const year = rest.slice(-4)
  if (!/^\d{4}$/.test(year)) return null

  const title = SHORT_CODE_TITLES.get(rest.slice(0, -4))
  return title === undefined ? null : { title, year }
}

/**
 * Encontra no CSV o título que o ticker designa.
 *
 * Aceita o código longo direto (e só confirma que existe) ou o código curto, que é
 * resolvido pelo par título + ano. Quando o mesmo título tem mais de um vencimento no ano
 * — só acontece em papéis antigos, como o Prefixado que vencia trimestralmente até 2009 —
 * escolhe o primeiro do ano e devolve o resto em `alternatives`, para a tela avisar.
 */
export function resolveTesouroCode(
  rows: readonly TesouroRow[],
  ticker: string,
): TesouroResolution | null {
  const trimmed = ticker.trim()

  if (trimmed.includes(';')) {
    const separator = trimmed.indexOf(';')
    const title = trimmed.slice(0, separator)
    const maturity = trimmed.slice(separator + 1)
    const exists = rows.some((r) => r.tipoTitulo === title && r.dataVencimento === maturity)
    return exists ? { code: trimmed, title, maturity, alternatives: [] } : null
  }

  const short = parseTesouroShortCode(trimmed)
  if (short === null) return null

  const maturities = [
    ...new Set(
      rows
        .filter((r) => r.tipoTitulo === short.title && r.dataVencimento.endsWith(short.year))
        .map((r) => r.dataVencimento),
    ),
  ].sort((a, b) => sortableMaturity(a).localeCompare(sortableMaturity(b)))

  const maturity = maturities[0]
  if (maturity === undefined) return null

  return {
    code: `${short.title};${maturity}`,
    title: short.title,
    maturity,
    alternatives: maturities.slice(1),
  }
}

/** Nome legível do ativo, para preencher o cadastro: `Tesouro IPCA+ 15/08/2026`. */
export function tesouroAssetName(title: string, maturity: string): string {
  return `${title} ${maturity}`
}

/** `dd/MM/yyyy` → `yyyyMMdd`, para comparar vencimentos como texto. */
function sortableMaturity(maturity: string): string {
  return maturity.slice(6, 10) + maturity.slice(3, 5) + maturity.slice(0, 2)
}
