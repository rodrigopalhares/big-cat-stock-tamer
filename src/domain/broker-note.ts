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

/** Uma execução da nota, como sai do PDF. */
export type NoteTrade = {
  readonly ticker: string
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
  const groups = new Map<
    string,
    { ticker: string; side: NoteSide; quantity: number; value: number }
  >()

  for (const trade of trades) {
    const ticker = trade.ticker.trim().toUpperCase()
    if (ticker === '') continue

    const key = `${ticker}|${trade.side}`
    const current = groups.get(key) ?? { ticker, side: trade.side, quantity: 0, value: 0 }
    groups.set(key, {
      ...current,
      quantity: current.quantity + trade.quantity,
      value: current.value + trade.quantity * trade.price,
    })
  }

  return [...groups.values()].map((g) => ({
    ticker: g.ticker,
    side: g.side,
    quantity: g.quantity,
    price: g.quantity === 0 ? 0 : g.value / g.quantity,
    value: g.value,
    fees: 0,
  }))
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
  const notes = note.noteNumber.trim() === '' ? '' : `Nota ${note.noteNumber.trim()}`

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
        notes,
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
