import { z } from 'zod'

/**
 * Resposta da API v8 de chart do Yahoo Finance.
 * Porte de src/main/kotlin/com/stocks/dto/YahooFinanceDtos.kt.
 *
 * Tudo é opcional porque o Yahoo omite campos sem aviso e muda o formato sem versionar.
 * O `.catch()` no topo transforma resposta inesperada em "sem dado" em vez de exceção —
 * equivale ao @JsonIgnoreProperties(ignoreUnknown = true) somado aos try/catch do Kotlin.
 */

const YahooChartMeta = z
  .object({
    currency: z.string().nullish(),
    symbol: z.string().nullish(),
    regularMarketPrice: z.number().nullish(),
    longName: z.string().nullish(),
    shortName: z.string().nullish(),
    instrumentType: z.string().nullish(),
    firstTradeDate: z.number().nullish(),
  })
  .loose()

const YahooChartQuote = z.object({ close: z.array(z.number().nullable()).nullish() }).loose()

const YahooChartResult = z
  .object({
    meta: YahooChartMeta.nullish(),
    timestamp: z.array(z.number()).nullish(),
    indicators: z
      .object({ quote: z.array(YahooChartQuote).nullish() })
      .loose()
      .nullish(),
  })
  .loose()

export const YahooChartResponse = z
  .object({
    chart: z
      .object({ result: z.array(YahooChartResult).nullish(), error: z.unknown().nullish() })
      .loose()
      .nullish(),
  })
  .loose()

export type YahooChartResponse = z.infer<typeof YahooChartResponse>
export type YahooChartResult = z.infer<typeof YahooChartResult>

/** Devolve null quando a resposta não tem o formato esperado, em vez de lançar. */
export function parseYahooChart(raw: unknown): YahooChartResponse | null {
  const parsed = YahooChartResponse.safeParse(raw)
  return parsed.success ? parsed.data : null
}
