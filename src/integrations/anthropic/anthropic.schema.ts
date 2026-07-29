import { z } from 'zod'

/**
 * Contrato do que a Anthropic devolve ao ler uma nota de negociação.
 *
 * O mesmo schema vira duas coisas: o JSON Schema que restringe a saída do modelo
 * (`output_config.format`) e a validação do que chega de volta. Uma fonte só — schema
 * duplicado é schema que sai de sincronia na primeira mudança.
 *
 * As descrições não são comentário: elas vão no JSON Schema e são o que orienta a
 * extração. Mexer nelas muda o resultado.
 */

export const NoteTradeExtraction = z.strictObject({
  ticker: z
    .string()
    .describe('Código de negociação do papel, ex.: XPLG11, PETR4. Só o código, sem o nome.'),
  side: z.enum(['C', 'V']).describe('C para compra, V para venda, como na coluna C/V da nota.'),
  quantity: z.number().describe('Quantidade desta execução.'),
  price: z.number().describe('Preço unitário desta execução.'),
})

export const NoteFeeExtraction = z.strictObject({
  label: z.string().describe('Nome da taxa como aparece no Resumo Financeiro.'),
  value: z.number().describe('Valor da taxa.'),
})

export const NoteExtraction = z.strictObject({
  tradeDate: z.string().describe('Data do pregão no formato YYYY-MM-DD.'),
  broker: z
    .string()
    .describe('Nome curto da corretora, ex.: "XP", "Clear", "Rico". Sem razão social completa.'),
  noteNumber: z.string().describe('Número da nota (campo "Nr. nota").'),
  trades: z
    .array(NoteTradeExtraction)
    .describe(
      'Toda execução da seção "Negócios realizados", de todas as páginas, uma por linha. ' +
        'Não agrupe e não some: repita o papel quantas vezes ele aparecer.',
    ),
  fees: z
    .array(NoteFeeExtraction)
    .describe(
      'Taxas cobradas com valor diferente de zero: taxa de liquidação, emolumentos, ' +
        'taxa de registro, taxa de transferência, corretagem, ISS, IRRF. Não inclua ' +
        'subtotais como "Total CBLC", "Total Bovespa" ou "Total Custos".',
    ),
  totalFees: z.number().describe('Soma das taxas listadas em `fees`.'),
  totalAmount: z
    .number()
    .describe('Valor líquido da nota (campo "Líquido para"), sempre positivo.'),
  checkedTotal: z
    .number()
    .describe(
      'Confira a sua própria extração: some quantidade × preço de todas as execuções e ' +
        'aplique as taxas (soma nas compras, subtrai nas vendas). Informe o resultado.',
    ),
  checkNotes: z
    .string()
    .describe(
      'Uma frase sobre a conferência: se `checkedTotal` bate com `totalAmount` e, se não ' +
        'bater, qual a provável causa. Em português.',
    ),
})

export type NoteExtraction = z.infer<typeof NoteExtraction>

/**
 * JSON Schema para `output_config.format`. O `$schema` sai porque a API não aceita
 * chaves fora do subconjunto que ela valida.
 */
export function noteExtractionJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(NoteExtraction) as Record<string, unknown>
  return schema
}
