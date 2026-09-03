/**
 * Última linha de uma tabela com rolagem infinita.
 *
 * Quando entra na tela (`revealed`), o HTMX busca a próxima página e troca esta linha
 * pelas linhas novas — que terminam em outra sentinela enquanto houver mais. A primeira
 * página vem no HTML da tela; daí em diante o servidor só devolve `<tr>`.
 *
 * Sem `hx-indicator`: a própria linha é o indicador, e some quando a resposta chega.
 */
export function LoadMoreRow({ href, colSpan }: { href: string; colSpan: number }) {
  return (
    <tr hx-get={href} hx-trigger="revealed" hx-swap="outerHTML">
      <td colSpan={colSpan} class="text-center text-muted small py-3">
        <span class="spinner-border spinner-border-sm me-1" role="status" /> Carregando mais...
      </td>
    </tr>
  )
}
