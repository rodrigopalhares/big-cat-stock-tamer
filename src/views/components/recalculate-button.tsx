/**
 * Botão que recalcula os snapshots mensais e recarrega a página ao terminar.
 *
 * O recálculo leva perto de um minuto. Como POST de formulário comum ele travava o navegador
 * esse tempo todo, sem nenhum sinal; por HTMX o botão vira "Recalculando..." com spinner
 * (`data-busy-label`, em `client/ui.ts`) e a página recarrega sozinha no sucesso.
 * Usado na Evolução e no card vazio do dashboard.
 */
export function RecalculateEvolutionButton({
  class: className = 'btn btn-outline-secondary btn-sm',
}: {
  class?: string
}) {
  return (
    <button
      type="button"
      class={className}
      hx-post="/evolution/recalculate"
      hx-swap="none"
      data-busy-label="Recalculando..."
      data-reload-on-success
    >
      <i class="bi bi-arrow-clockwise me-1" /> Recalcular
    </button>
  )
}
