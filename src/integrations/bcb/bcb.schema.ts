import { z } from 'zod'

/**
 * Respostas das APIs do Banco Central.
 * Porte de src/main/kotlin/com/stocks/dto/BcbDtos.kt e do BcbSeriesEntry de BenchmarkService.kt.
 */

/** PTAX — cotação do dólar por período. */
export const BcbPtaxResponse = z
  .object({
    value: z
      .array(
        z
          .object({
            cotacaoCompra: z.number(),
            cotacaoVenda: z.number(),
            dataHoraCotacao: z.string(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose()

export type BcbPtaxResponse = z.infer<typeof BcbPtaxResponse>

/** SGS — série temporal; o valor vem como string com vírgula decimal. */
export const BcbSeriesResponse = z.array(
  z.object({ data: z.string().default(''), valor: z.string().default('') }).loose(),
)

export type BcbSeriesResponse = z.infer<typeof BcbSeriesResponse>
