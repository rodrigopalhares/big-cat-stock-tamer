/**
 * JSON legível na tela: identação e classificação dos pedaços para colorir.
 *
 * O destaque sai em *tokens*, não em HTML montado à mão. O texto vem de fora (é resposta
 * de modelo), e devolver string com `<span>` obrigaria a `dangerouslySetInnerHTML` — um
 * `</pre><script>` no meio de um nome de papel viraria injeção. Como token, quem escapa
 * é o próprio JSX.
 */

export type JsonTokenType = 'key' | 'string' | 'number' | 'literal' | 'plain'

export type JsonToken = {
  readonly text: string
  readonly type: JsonTokenType
}

/** Identa o JSON; texto que não for JSON válido volta como veio. */
export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

// String primeiro na alternância: assim número e literal dentro de aspas não são
// reconhecidos por engano — a string já foi consumida inteira quando a varredura chega lá.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = []
  let cursor = 0

  for (const match of text.matchAll(TOKEN)) {
    const [whole = '', string, colon, number, literal] = match
    const start = match.index

    if (start > cursor) tokens.push({ text: text.slice(cursor, start), type: 'plain' })

    if (string !== undefined) {
      // Aspas seguidas de dois-pontos são chave; o resto é valor.
      tokens.push({ text: string, type: colon === undefined ? 'string' : 'key' })
      if (colon !== undefined) tokens.push({ text: colon, type: 'plain' })
    } else if (number !== undefined) {
      tokens.push({ text: number, type: 'number' })
    } else if (literal !== undefined) {
      tokens.push({ text: literal, type: 'literal' })
    }

    cursor = start + whole.length
  }

  if (cursor < text.length) tokens.push({ text: text.slice(cursor), type: 'plain' })
  return tokens
}
