/**
 * Escape de texto que vai para dentro de HTML.
 *
 * Existe por causa de um caminho só: a resposta de erro do `src/plugins/errors.ts`, que é o
 * único lugar da aplicação onde texto vira HTML sem passar por uma view JSX — e o JSX é quem
 * escapa em todo o resto. Mensagem de erro carrega entrada do usuário (o nome da classe de
 * alocação, o content-type do upload), então sem isto um `<svg onload=...>` num formulário
 * volta executável para o navegador.
 *
 * Responder `text/plain` NÃO resolveria: o HTMX injeta o corpo no DOM como HTML, qualquer que
 * seja o content-type declarado.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}
