# Views

Componentes JSX renderizados no servidor (`preact-render-to-string`). Sem React no cliente:
o HTML sai pronto e o HTMX cuida da interatividade.

## Rótulos e controles

Todo `<label class="form-label">` tem `for` apontando para o `id` do controle — a regra
`noLabelWithoutControl` do Biome está ligada nesta pasta e é quem garante isso. Os 41 rótulos
sem `for` herdados dos templates Thymeleaf foram corrigidos de uma vez; o `id` segue o prefixo
do formulário (`tx*` no de nova transação, `editTx*` no modal, `newDiv*`/`editDiv*` nos de
provento, `asset*`/`edit*` nos de ativo), então dois formulários na mesma página nunca
disputam o mesmo identificador.

Botão só com ícone leva `aria-label` além do `title`: o `title` some no toque e o leitor de
tela não o anuncia com consistência.
