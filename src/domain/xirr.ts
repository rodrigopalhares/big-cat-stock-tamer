import { daysBetween, type IsoDate } from '../shared/iso-date.js'

/**
 * Taxa interna de retorno. Porte das funções privadas de CalculationService.kt.
 *
 * Os algoritmos são reproduzidos passo a passo — mesmos chutes iniciais, mesmos limites
 * de iteração, mesmas tolerâncias. `Double` do Kotlin e `number` do JS são ambos
 * IEEE-754 binary64, então os resultados são idênticos bit a bit.
 */

export type CashFlow = {
  readonly date: IsoDate
  readonly value: number
}

/** IRR por Newton-Raphson, com os fluxos tratados como períodos consecutivos. */
export function computeIrr(
  values: readonly number[],
  guess = 0.1,
  maxIterations = 200,
  tolerance = 1e-7,
): number {
  let rate = guess
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0
    let dnpv = 0
    for (let j = 0; j < values.length; j++) {
      const value = values[j] as number
      npv += value / (1 + rate) ** j
      dnpv -= (j * value) / (1 + rate) ** (j + 1)
    }
    if (Math.abs(dnpv) < 1e-12) break
    const newRate = rate - npv / dnpv
    if (Math.abs(newRate - rate) < tolerance) return newRate
    rate = newRate
  }
  return rate
}

/**
 * XIRR por bisseção, com os fluxos posicionados pela data real.
 *
 * A data de referência é a do *primeiro* fluxo da lista, não a menor — igual ao Kotlin.
 * Devolve null quando não há troca de sinal no intervalo pesquisado.
 */
export function xirr(flows: readonly CashFlow[]): number | null {
  const first = flows[0]
  if (!first) return null
  const ref = first.date

  const npv = (rate: number): number =>
    flows.reduce((sum, { date, value }) => {
      const days = daysBetween(ref, date)
      return sum + value / (1 + rate) ** (days / 365)
    }, 0)

  let lo = -0.9999
  let hi = 100
  let npvLo = npv(lo)
  const npvHi = npv(hi)

  if (npvLo * npvHi > 0) return null

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const npvMid = npv(mid)
    if (Math.abs(npvMid) < 1e-7 || hi - lo < 1e-9) return mid
    if (npvLo * npvMid < 0) {
      hi = mid
    } else {
      lo = mid
      npvLo = npvMid
    }
  }
  return (lo + hi) / 2
}
