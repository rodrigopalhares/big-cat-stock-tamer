# Views

Componentes JSX renderizados no servidor (`preact-render-to-string`). Sem React no cliente:
o HTML sai pronto e o HTMX cuida da interatividade.

## `noLabelWithoutControl` desligada aqui

Os 41 `<label class="form-label">` desta pasta vieram dos templates Thymeleaf sem atributo
`for`. É uma falha de acessibilidade real — leitor de tela não associa o rótulo ao campo —,
mas **pré-existente**: o Biome só a enxerga porque agora o markup é JSX, e o linter nunca
rodou sobre os `.html`.

A regra está desligada em `biome.json` para esta pasta porque corrigir durante o porte
significaria inventar `id` para 41 campos, com risco de duplicar identificador entre um
formulário e o modal que repete os mesmos rótulos. Corrigir isso é uma tarefa separada,
depois da migração fechar, quando dá para testar campo a campo.

O resto das regras de acessibilidade continua ligado.
