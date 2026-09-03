/**
 * Caminho com query string, ignorando parâmetro vazio ou nulo.
 *
 * É o que monta a URL da próxima página de uma lista com rolagem infinita: os filtros
 * ativos precisam ir junto, senão a segunda página vem sem filtro e mistura tudo.
 */
export function pathWithQuery(
  path: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query === '' ? path : `${path}?${query}`
}
