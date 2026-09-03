/**
 * Cabeçalhos e leitura de erro para os `fetch` do cliente.
 *
 * O handler central (src/plugins/errors.ts) escolhe o formato do erro pelo pedido: JSON com
 * `Accept: application/json`, fragmento com `HX-Request`, e a **página inteira** no resto.
 * Um `fetch` sem cabeçalho cai no resto — e o alerta do modal passou a exibir o HTML da
 * página de erro em vez da frase. Daí cada chamada declarar o que aceita.
 */

/** Sucesso em JSON (lote): erro também em JSON. */
export const ACCEPT_JSON = { Accept: 'application/json' } as const

/**
 * Sucesso em HTML (parciais do HTMX, como a prévia da nota): `text/html` primeiro para o
 * parcial, `application/json` para o erro — o handler só olha se JSON está na lista.
 */
export const ACCEPT_HTML_OR_JSON = { Accept: 'text/html, application/json' } as const

/**
 * Motivo legível de uma resposta de erro: o `error` (mais `details`, quando é validação) do
 * JSON do handler, ou o texto cru quando não for JSON. Vazio cai no [fallback].
 */
export async function errorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text()
  return parseError(text) ?? (text === '' ? fallback : text)
}

function parseError(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: unknown; details?: unknown }
    if (typeof body.error !== 'string') return null
    const details = Array.isArray(body.details) ? body.details.map(String) : []
    return [body.error, ...details].join(' ')
  } catch {
    return null
  }
}
