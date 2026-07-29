import { type IsoDate, toBrazilianDate } from '../shared/iso-date.js'

/**
 * Nota de negociação: agrupamento por ticker, rateio das taxas e conferência do total.
 * Puro e síncrono — quem lê o PDF é `integrations/anthropic`, quem grava é o service.
 *
 * A nota lista cada execução separadamente (uma compra de 329 cotas pode aparecer em 19
 * linhas de 1 a 100 cotas). O que vira transação é o agrupado: uma linha por ticker, com
 * preço médio ponderado e a fatia proporcional das taxas.
 */

export type NoteSide = 'C' | 'V'

/**
 * De onde veio o ticker da operação.
 *
 * Nem toda nota imprime o código de negociação: a 139054003 traz só "CSU DIGITAL ON NM" e
 * "METAL LEVE ON NM". Pedir o código nesse caso é pedir um chute — e o modelo chutou
 * CSUD11 e GGBR4 (Gerdau!) no lugar de CSUD3 e LEVE3, com a conferência do total fechando
 * assim mesmo, porque quantidade e preço estavam certos. Por isso a origem viaja junto:
 * ticker deduzido não pode parecer ticker lido.
 */
export type TickerSource =
  /** Impresso na nota, ao lado do papel. */
  | 'NOTE'
  /** Deduzido do nome do papel contra os ativos já cadastrados. */
  | 'NAME'
  /** Não identificado — a linha vai para revisão com o ticker em branco. */
  | 'NONE'

/** Uma execução da nota, como sai do PDF. */
export type NoteTrade = {
  /** Vazio quando a nota não imprime o código — aí quem manda é [security]. */
  readonly ticker: string
  /** Nome do papel como impresso na nota: "CSU DIGITAL", "FII XP LOG". */
  readonly security: string
  readonly tickerSource: TickerSource
  readonly side: NoteSide
  readonly quantity: number
  readonly price: number
}

/** Uma linha do "Resumo Financeiro" da nota. */
export type NoteFee = {
  readonly label: string
  readonly value: number
}

export type BrokerNoteData = {
  readonly date: IsoDate
  readonly broker: string
  readonly noteNumber: string
  /** Soma das taxas da nota (liquidação, emolumentos, transferência, corretagem). */
  readonly totalFees: number
  /** Líquido declarado pela corretora, sempre positivo. */
  readonly totalAmount: number
  readonly trades: readonly NoteTrade[]
}

/** Uma linha do CSV: o consolidado de um ticker dentro da nota. */
export type NoteGroup = {
  readonly ticker: string
  readonly security: string
  readonly tickerSource: TickerSource
  readonly side: NoteSide
  readonly quantity: number
  /** Médio ponderado — `value / quantity`, sem arredondar. */
  readonly price: number
  /** Valor operado do ticker: Σ (quantidade × preço). É o peso do rateio das taxas. */
  readonly value: number
  readonly fees: number
}

export type NoteCheck = {
  readonly ok: boolean
  readonly declared: number
  readonly calculated: number
  readonly difference: number
}

const TOLERANCE = 0.01

/**
 * O "Resumo Financeiro" intercala parcelas e subtotais: "Total CBLC" é a soma do bloco de
 * cima, "Total Bovespa / Soma" a do bloco do meio, "Total Custos / Despesas" a do de baixo.
 * Somar tudo cobra a mesma taxa duas vezes.
 */
const SUBTOTAL_LABEL = /^\s*total\b/i

export function isSubtotalFee(label: string): boolean {
  return SUBTOTAL_LABEL.test(label)
}

/** Soma das taxas ignorando as linhas de subtotal. */
export function sumItemizedFees(fees: readonly NoteFee[]): number {
  return round2(
    fees.filter((fee) => !isSubtotalFee(fee.label)).reduce((sum, fee) => sum + fee.value, 0),
  )
}

/**
 * Decide o total de taxas entre o que o modelo declarou e a soma das parcelas.
 *
 * Ele já devolveu "Total Bovespa / Soma 2,14" ao lado de "Emolumentos 1,41" e "Taxa de
 * Transf. de Ativos 0,73", e um total de 10,63 somando tudo — as mesmas taxas duas vezes,
 * com a nota fechando R$ 2,14 acima do líquido. Instrução em prompt não garante isso.
 *
 * A correção só entra quando o total declarado bate com a soma de *tudo*, que é a assinatura
 * do subtotal contado duas vezes. Se ele não bate, a lista provavelmente está incompleta —
 * e aí subtrair as parcelas faltantes seria trocar um erro por outro.
 */
export function resolveTotalFees(fees: readonly NoteFee[], declaredTotal: number): number {
  const declared = Math.abs(declaredTotal)
  const everything = round2(fees.reduce((sum, fee) => sum + fee.value, 0))

  return Math.abs(everything - declared) <= TOLERANCE ? sumItemizedFees(fees) : declared
}

/**
 * Junta as execuções por ticker **e sentido** — day trade lista compra e venda do mesmo
 * papel, e misturar as duas daria um preço médio sem significado.
 * A ordem de saída é a da primeira aparição na nota.
 */
export function groupTrades(trades: readonly NoteTrade[]): NoteGroup[] {
  type Accumulator = Omit<NoteGroup, 'price' | 'fees'>
  const groups = new Map<string, Accumulator>()

  for (const trade of trades) {
    const ticker = trade.ticker.trim().toUpperCase()
    const security = trade.security.trim()
    // Sem ticker o papel ainda é identificável pelo nome; sem os dois, não há o que agrupar.
    if (ticker === '' && security === '') continue

    const key = `${ticker === '' ? security.toUpperCase() : ticker}|${trade.side}`
    const current = groups.get(key) ?? {
      ticker,
      security,
      tickerSource: trade.tickerSource,
      side: trade.side,
      quantity: 0,
      value: 0,
    }
    groups.set(key, {
      ...current,
      quantity: current.quantity + trade.quantity,
      value: current.value + trade.quantity * trade.price,
    })
  }

  return [...groups.values()].map((g) => ({
    ...g,
    price: g.quantity === 0 ? 0 : g.value / g.quantity,
    fees: 0,
  }))
}

const CORPORATE_NOISE =
  /\b(S\.?\/?A\.?|SA|LTDA|CIA|COMPANHIA|HOLDING|PARTICIPACOES|PARTICIPACAO|FII|FUNDO|INVESTIMENTO|IMOBILIARIO|ON|PN|PNA|PNB|NM|N1|N2|EJ|CI|UNT|EDJ|ED)\b/g

/**
 * Nome de papel comparável: sem acento, sem pontuação e sem o ruído societário que só um
 * dos lados escreve. "CSU DIGITAL ON NM" e "CSU Digital S.A." caem os dois em "CSU DIGITAL".
 */
export function normalizeSecurityName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9/. ]/g, ' ')
    .replace(CORPORATE_NOISE, ' ')
    .replace(/[/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Acha o ticker do papel entre os ativos já cadastrados, pelo nome impresso na nota.
 *
 * Devolve null quando não acha **ou quando acha mais de um**: "GERDAU" casa com GGBR4 e
 * GOAU4, e chutar entre os dois é o erro que esta função existe para evitar. Ambíguo vai
 * para revisão manual.
 */
export function matchSecurity(
  security: string,
  assets: readonly { readonly ticker: string; readonly name: string | null }[],
): string | null {
  const target = normalizeSecurityName(security)
  if (target === '') return null

  const named = assets
    .filter((a) => a.name !== null && a.name.trim() !== '')
    .map((a) => ({ ticker: a.ticker, name: normalizeSecurityName(a.name ?? '') }))

  const exact = named.filter((a) => a.name === target)
  if (exact.length === 1) return exact[0]?.ticker ?? null
  if (exact.length > 1) return null

  // A nota abrevia ("METAL LEVE" para "MAHLE Metal Leve S.A."), então vale conter.
  const partial = named.filter((a) => a.name.includes(target) || target.includes(a.name))
  return partial.length === 1 ? (partial[0]?.ticker ?? null) : null
}

/**
 * Rateia as taxas proporcionalmente ao valor operado de cada ticker.
 *
 * O resíduo de arredondamento vai para o ticker de maior valor, então a soma das fatias
 * bate no centavo com o total da nota — sem isso, uma nota com três tickers pode "perder"
 * um centavo e a conferência acusa uma diferença que não existe.
 */
export function allocateFees(groups: readonly NoteGroup[], totalFees: number): NoteGroup[] {
  const totalValue = groups.reduce((sum, g) => sum + g.value, 0)
  if (groups.length === 0 || totalValue <= 0 || totalFees === 0) {
    return groups.map((g) => ({ ...g, fees: 0 }))
  }

  const allocated = groups.map((g) => ({ ...g, fees: round2(totalFees * (g.value / totalValue)) }))

  const residue = round2(totalFees - allocated.reduce((sum, g) => sum + g.fees, 0))
  if (residue !== 0) {
    const target = largestIndex(allocated)
    const group = allocated[target]
    if (group !== undefined) allocated[target] = { ...group, fees: round2(group.fees + residue) }
  }
  return allocated
}

/**
 * Confere o total: numa nota compradora o líquido é o valor operado **mais** as taxas;
 * numa vendedora, o valor operado **menos** as taxas. Notas com os dois sentidos usam o
 * saldo líquido para decidir de que lado as taxas entram.
 */
export function checkTotal(groups: readonly NoteGroup[], note: BrokerNoteData): NoteCheck {
  const net = groups.reduce((sum, g) => sum + (g.side === 'C' ? g.value : -g.value), 0)
  const calculated = round2(Math.abs(net) + (net >= 0 ? note.totalFees : -note.totalFees))
  const declared = round2(Math.abs(note.totalAmount))
  const difference = round2(calculated - declared)

  return { ok: Math.abs(difference) <= TOLERANCE, declared, calculated, difference }
}

/** Agrupar + ratear, na ordem certa. É o que o service usa. */
export function summarizeNote(note: BrokerNoteData): NoteGroup[] {
  return allocateFees(groupTrades(note.trades), note.totalFees)
}

/**
 * Converte para o CSV que a importação de transações já entende — mesmas dez colunas
 * separadas por TAB. Reaproveitar o formato evita um segundo caminho de importação.
 */
export function toCsv(note: BrokerNoteData, groups: readonly NoteGroup[]): string {
  const date = toBrazilianDate(note.date)
  const base = note.noteNumber.trim() === '' ? '' : `Nota ${note.noteNumber.trim()}`

  return groups
    .map((g) =>
      [
        g.ticker,
        date,
        g.side,
        decimal(g.quantity),
        decimal(g.price),
        decimal(g.fees, 2, 2),
        note.broker.trim(),
        '0',
        'BRL',
        // Sem ticker a linha entra na revisão em branco: o nome do papel vai junto para
        // dizer qual código digitar.
        g.ticker === '' ? [base, g.security].filter((p) => p !== '').join(' · ') : base,
      ].join('\t'),
    )
    .join('\n')
}

/** Mensagem do aviso quando a conferência não fecha; `null` quando fecha. */
export function checkWarning(check: NoteCheck): string | null {
  if (check.ok) return null
  return (
    `Total da nota não confere: declarado ${check.declared.toFixed(2)}, ` +
    `calculado ${check.calculated.toFixed(2)} (diferença ${check.difference.toFixed(2)}).`
  )
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function largestIndex(groups: readonly NoteGroup[]): number {
  let index = 0
  for (let i = 1; i < groups.length; i++) {
    if ((groups[i]?.value ?? 0) > (groups[index]?.value ?? 0)) index = i
  }
  return index
}

/**
 * Número no formato brasileiro, com casas variáveis.
 *
 * O preço médio precisa das oito casas: `30151,95 / 329` dá 91,64726444 e cortar em duas
 * casas jogaria quinze reais fora do custo da posição. Zeros à direita além do mínimo
 * saem — `329` não vira `329,00000000`.
 */
function decimal(value: number, max = 8, min = 0): string {
  const [whole = '0', rawFraction = ''] = value.toFixed(max).split('.')
  const fraction = (min < max ? rawFraction.replace(/0+$/, '') : rawFraction).padEnd(min, '0')
  return fraction === '' ? whole : `${whole},${fraction}`
}
