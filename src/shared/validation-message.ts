import type { ZodIssue } from 'zod'

/**
 * Traduz os `issues` de um ZodError para frases que dão para mostrar na tela.
 *
 * O Zod fala inglês e em termos de tipo ("expected number, received NaN"); quem digitou
 * "abc" na quantidade precisa ler "Quantidade deve ser um número". O nome do campo é o
 * `name` do formulário, então o mapa abaixo é o dicionário entre o HTML e o rótulo que a
 * tela já usa. Campo fora do mapa aparece com o próprio nome — melhor do que sumir.
 */
const FIELD_LABELS: Record<string, string> = {
  ticker: 'Ticker',
  type: 'Tipo',
  quantity: 'Quantidade',
  price: 'Preço unitário',
  total_price: 'Valor bruto',
  fees: 'Taxas',
  date: 'Data',
  currency: 'Moeda',
  broker: 'Corretora',
  notes: 'Notas',
  total_amount: 'Valor bruto',
  tax_withheld: 'IR retido',
  name: 'Nome',
  yf_ticker: 'Código no Yahoo Finance',
  asset_class_id: 'Classe',
  target_percent: 'Meta',
  color: 'Cor',
  class_id: 'Classe',
  password: 'Senha',
  csv: 'CSV',
  id: 'Id',
  // A API JSON usa camelCase para os mesmos campos.
  assetId: 'Ticker',
  totalAmount: 'Valor bruto',
  taxWithheld: 'IR retido',
  yfTicker: 'Código no Yahoo Finance',
  assetClassId: 'Classe',
  brokerNoteId: 'Nota de negociação',
}

/** Como começam as mensagens padrão do Zod 4 — o resto é mensagem escrita no schema. */
const ZOD_DEFAULT = /^(Invalid|Too small|Too big|Unrecognized|Expected|Required)/

export function describeIssues(issues: readonly ZodIssue[]): string[] {
  return issues.map((issue) =>
    // Mensagem escrita no schema ("Meta não pode ser negativa") já vem pronta e nomeia o
    // campo; prefixar o rótulo daria "Meta Meta não pode ser negativa".
    ZOD_DEFAULT.test(issue.message)
      ? `${fieldLabel(issue.path)} ${describeIssue(issue)}`
      : issue.message,
  )
}

function fieldLabel(path: ReadonlyArray<PropertyKey>): string {
  const field = path.map(String).join('.')
  if (field === '') return 'Dados'
  return FIELD_LABELS[field] ?? field
}

function describeIssue(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type': {
      // O Zod 4 não expõe `received` no tipo, mas o preenche — e é ele que separa campo em
      // branco ("received undefined") de campo com lixo ("received NaN").
      const received = (issue as { received?: unknown }).received
      if (received === 'undefined') return 'é obrigatório'
      if (issue.expected === 'number') return 'deve ser um número'
      if (issue.expected === 'string') return 'deve ser um texto'
      return `deve ser ${issue.expected}`
    }
    case 'too_small':
      if (issue.origin === 'string') {
        return issue.minimum === 1
          ? 'é obrigatório'
          : `deve ter pelo menos ${issue.minimum} caracteres`
      }
      return issue.inclusive
        ? `deve ser no mínimo ${issue.minimum}`
        : `deve ser maior que ${issue.minimum}`
    case 'too_big':
      if (issue.origin === 'string') return `deve ter no máximo ${issue.maximum} caracteres`
      return issue.inclusive
        ? `deve ser no máximo ${issue.maximum}`
        : `deve ser menor que ${issue.maximum}`
    case 'invalid_value':
      return `deve ser um destes: ${issue.values.map(String).join(', ')}`
    case 'invalid_format':
      return 'está em formato inválido'
    default:
      return issue.message
  }
}
