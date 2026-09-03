# Stocks Application

Aplicação pessoal de acompanhamento de carteira de investimentos, em TypeScript.

## Comandos

- **Rodar**: `npm run dev`
- **Build**: `npm run build`
- **Testes**: `npm test`
- **Tipos**: `npm run typecheck`
- **Lint**: `npm run lint` (Biome + typescript-eslint + dependency-cruiser + prisma validate)
- **Formatar**: `npm run format`
- **Tudo**: `npm run check`
- **Migrations**: `npm run db:migrate` (dev) · `npm run db:deploy` (aplicar) · `npm run db:seed`

## Diretrizes

- **Simplicidade**: prefira solução simples a abstração complexa.
- **Código em inglês**, **interface em português** (labels, mensagens, textos de tela).
- **Mudanças cirúrgicas**: mexa no necessário e verifique com testes.
- **Testes obrigatórios**: ao criar ou alterar uma feature, crie ou atualize os testes junto,
  no mesmo commit.
- **Skills**: quando uma feature tem skill em `.claude/skills/`, atualize a skill se a
  mudança afetar o escopo dela.

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript 5.9 / Node 22 |
| Servidor | Fastify 5 |
| Banco | SQLite (better-sqlite3) |
| ORM / migrations | Prisma 7 |
| Views | JSX no servidor (`preact-render-to-string`) + HTMX |
| CSS | Bootstrap 5 (CDN) |
| Validação | Zod |
| HTTP client | `fetch` nativo · `@anthropic-ai/sdk` (leitura de nota) |
| Scheduler | croner |
| Testes | Vitest + MSW |
| Lint/format | Biome + typescript-eslint + dependency-cruiser |

## Arquitetura

Módulos por feature em `src/modules/<feature>/`, cada um com rota, service, schema e teste
juntos. O que não é de feature fica fora:

```
src/
  domain/        funções puras — cálculo, XIRR, regressão, parsing de CSV. Sem I/O.
  integrations/  clientes HTTP (Yahoo, BCB, Tesouro). Não persistem.
  modules/       uma pasta por feature: *.routes.ts, *.service.ts, *.schema.ts, *.test.ts
  views/         componentes JSX. Recebem tudo por props.
  plugins/       hooks do Fastify (auth, erros, views)
  infra/         backup e scheduler
  shared/        utilidades sem dono (datas, formatação, HttpError)
  client/        TypeScript de navegador, compilado por esbuild para public/js/
  config/        ambiente (Zod) e conexão do banco
  container.ts   composition root — instancia e liga os services
```

### Regras de camada

Verificadas pelo `dependency-cruiser` no CI, não só combinadas:

- `domain/` não importa Prisma, Fastify, service ou integração. Se precisa de `await`,
  não pertence ao domínio.
- `views/` não chama service nem Prisma. Import **type-only** de schema é permitido — é o
  contrato tipado entre rota e view.
- `integrations/` busca dado externo e devolve; quem persiste é o service.
- Rota não tem lógica de negócio: valida com Zod, chama um service, escolhe a resposta.

## Convenções

- Arquivos em `kebab-case`, com sufixo `.service.ts`, `.routes.ts`, `.schema.ts`, `.test.ts`.
- Sem `export default` — sempre nomeado.
- `any` proibido; use `unknown` + validação Zod na fronteira externa.
- Erros de aplicação via `HttpError`; um único `setErrorHandler` (`src/plugins/errors.ts`) decide
  JSON, fragmento HTMX ou a página de erro com layout. `ZodError` vira 400 ali mesmo, com uma frase
  em português por campo (`src/shared/validation-message.ts`) — rota não precisa de `safeParse`.
  Mensagem de `HttpError` é texto de tela: escreva em português.
- Cor de tipo de ativo sai de `src/shared/asset-colors.ts` — gráficos e badges leem do mesmo
  mapa, então STOCK é o mesmo azul em toda a interface. Tipo novo entra lá, e só lá.

## Decisões que valem conhecer antes de mexer

**Data de calendário é `string` ISO, não `Date`.** O tipo `IsoDate` em `src/shared/iso-date.ts`
substitui o `LocalDate` do Java. Toda aritmética passa por `Date.UTC`, então nada depende do
fuso do processo. Usar `Date` para data de transação reintroduz o bug de "o dia 1º aparece
como dia 31 do mês anterior".

**Título do Tesouro tem dois códigos.** O ativo é cadastrado pelo código curto `TD:IPCA2026`
— que é a chave primária, aparece em tabela e URL — e o código do CSV
(`Tesouro IPCA+;15/08/2026`) fica em `yfTicker`, que é o que os clientes de cotação
consultam. `src/domain/tesouro-ticker.ts` traduz um no outro contra o CSV já em cache.
O sufixo `J` marca "com Juros Semestrais": `TD:IPCA2035` é o principal e `TD:IPCAJ2035` é o
de cupom — mesmo vencimento, PU quase o dobro, então trocar um pelo outro erra a carteira
em silêncio.

**Trocar o `yfTicker` refaz a série de preços.** `price_history` é chaveada pelo ticker do
cadastro, não pelo símbolo externo — então corrigir o `yfTicker` deixaria os preços do papel
antigo no histórico do ativo, misturados aos novos e indistinguíveis, e ninguém os
reescreveria (`runBackfill` retoma do último preço gravado). Por isso `AssetService.update`
chama `refetchAssetHistory` quando o símbolo resolvido muda. Ele **busca antes de apagar**:
símbolo errado devolve série vazia, e destruir o histórico aí deixaria a evolução com um
buraco de anos. Nesse caso nada é tocado e a tela avisa.

**Classe de alocação não é tipo de ativo.** `assets.type` diz o que o papel é (ETF, BDR,
INTERNATIONAL); `assets.asset_class_id` diz em que fatia da carteira ele conta — e os três
exemplos acima caem na mesma classe "Internacional". O tipo só define a classe *inicial*,
por `src/domain/asset-class.ts`; depois disso quem manda é o que o usuário escolheu na tela.
O mesmo mapa está escrito em SQL na migration `add_asset_classes`, que classificou o acervo
existente: mexer num sem mexer no outro deixa histórico e ativo novo em classes diferentes.
A FK é `ON DELETE SET NULL` e ativo sem classe aparece no balde "Sem classe" de `/allocation/`,
em vez de sumir da conta.

**Posição não fica negativa, e quem garante é o service.** Venda ou agrupamento que deixaria a
quantidade abaixo de zero em *qualquer ponto* do histórico é recusado com 400 — refazendo a
sequência inteira por data, porque a venda lançada com data antiga passa batido em quem olha só
o saldo de hoje. A regra vive em `TransactionService.assertPositionStaysNonNegative`, e não na
rota, porque formulário, API e lote do CSV escrevem pelo mesmo caminho; o lote a roda para todas
as linhas de um ticker antes de gravar a primeira, senão parar no meio deixaria metade no banco
para duplicar no reenvio. Só a linha nova acusa: histórico já furado não trava o ativo. No mesmo
dia, o que soma conta antes do que reduz. Provento segue a mesma ideia com valor bruto positivo e
IR entre zero e o bruto.

**Nada de rede dentro de transação.** O SQLite tem escritor único; segurar o lock durante uma
chamada HTTP trava a aplicação inteira. Busque primeiro, escreva depois.

**A comparação com o CDI é uma carteira-sombra, não uma taxa.** `CdiService.compare` aplica os
*mesmos* fluxos de caixa da carteira numa conta rendendo CDI diário. Comparar a TIR contra o CDI
nominal do período seria mais simples e estaria errado: a TIR é ponderada por dinheiro-tempo e o
CDI acumulado não, então com aportes irregulares os dois números não falam do mesmo período. Com
o cronograma idêntico dos dois lados, a diferença que sobra é escolha de ativo.

Três detalhes que já custaram caro:

- **A série diária do BCB (SGS 12) recusa janela maior que dez anos**, com 406. A carteira começa
  em 2008, então um pedido único falharia — e como `HttpClient` transforma status ruim em `null`,
  falharia *calado*. Por isso `fetchCdiDailyRange` fatia em janelas de cinco anos.
- **A série não repete fim de semana**, ao contrário de `exchange_rates`. Lá repetir a cotação de
  sexta é certo, porque transação de sábado precisa de taxa; aqui repetir criaria rendimento que
  não existiu.
- **O dashboard nunca busca a série.** Quem popula é o job das 18:30 e o botão "Atualizar
  Cotações" — a carga inicial leva ~22s. Série defasada rende menos e faz a carteira parecer
  melhor do que é, então a tela mostra a data da última taxa em vez de esconder o problema.

**O CDI vem da série 4389.** A 4391 é o CDI *acumulado no mês* (% a.m.) e a 432 é a Selic meta;
trocar uma pela outra devolve um número plausível e errado. Ver o teste que fixa o número na URL.

**`Float` continua `Float`.** Não troque por `Decimal` sem uma bateria de validação própria —
os resultados de TIR e preço médio mudariam.

**Backup é `VACUUM INTO`**, cópia consistente com a aplicação escrevendo. Nunca cópia de arquivo.

## Banco de dados

SQLite em `${APP_DATA_DIR}/stocks.db` (padrão `./data`). Migrations em `prisma/migrations/`,
aplicadas com `npm run db:deploy`. `PRAGMA journal_mode = WAL` e `foreign_keys = ON` são
aplicados no boot — o segundo é obrigatório, senão o SQLite ignora silenciosamente os
`ON DELETE CASCADE`.

## Backup

`BackupService` (I/O) + `backup-retention` (política pura) tiram snapshot ao subir e às 00:05
(`America/Sao_Paulo`). Dois conjuntos: `daily/stocks-yyyy-MM-dd.db.gz` (7 cópias) e
`monthly/stocks-yyyy-MM.db.gz` (3). Idempotente por período — reiniciar várias vezes no mesmo
dia não duplica nada. Banco em memória é no-op. Configuração em `APP_BACKUP_*`.
O arquivo é gzip de um `.db`, não um zip — restaurar é parar a aplicação e rodar
`gunzip -c <backup> > ${APP_DATA_DIR}/stocks.db`.

## Nota de negociação

A aba "Nota de negociação" do modal de importação manda o PDF para a Anthropic
(`claude-haiku-4-5`, saída estruturada) e devolve as operações agrupadas por ticker, com as
taxas rateadas pelo **valor operado** de cada papel. O resultado vira o mesmo CSV da
importação manual — não existe um segundo caminho de importação.

O arquivo enviado fica em `${APP_NOTES_DIR}/<ano>/<yyyyMMdd>_<id>.<ext>` (padrão
`./data/notas`, fora do versionamento) e a resposta do modelo, verbatim, na coluna
`ai_response` de `broker_notes` — o CSV é derivado dela e não é gravado, então é a resposta
que permite refazer a conta e separar erro de leitura de erro de cálculo. As transações
criadas guardam `broker_note_id`, que é o que dá o link de download na linha do histórico.

Chave em `APP_ANTHROPIC_API_KEY`; em branco, a aba fica desativada. O total da nota é
conferido (`Σ quantidade × preço ± taxas` contra o líquido declarado) — divergência avisa e
deixa seguir, porque o preview do CSV é editável.

**A conferência do total não protege contra ticker errado.** Nota que não imprime o código
de negociação — só "CSU DIGITAL ON NM" — fecha no centavo com o papel trocado, porque
quantidade e preço estão certos. Por isso o modelo é proibido de deduzir o código: sem código
impresso ele devolve o nome, e o service resolve contra os ativos cadastrados. Nome ambíguo
ou desconhecido fica em branco e vai para a revisão manual.

## Autenticação

Usuário único, senha em `APP_AUTH_PASSWORD` — **obrigatória**, mínimo 12 caracteres. Campo
em branco derruba o boot: desligar a autenticação exige `APP_AUTH_DISABLED=true` explícito, e
essa flag não é aceita com `NODE_ENV=production`. Com senha configurada a flag é ignorada — a
assimetria é de propósito, porque errar para o lado "ligado" nunca abre a aplicação sem querer.
As sessões são persistidas em `${APP_DATA_DIR}/auth.key` como *hashes* de token — o arquivo
nunca guarda o token em claro, então vazá-lo não dá acesso a ninguém.

Tentativas erradas são contadas por IP, em memória: cinco numa janela de um minuto bloqueiam, e
o bloqueio cresce (1 min, 5, 15). Comparar em tempo constante defende de ataque por temporização,
não de volume — e com um segredo só protegendo tudo, num processo que escuta em `0.0.0.0`, é o
volume que importa. O `level` do cliente sobrevive uma hora ao fim do bloqueio; sem isso bastaria
esperar um minuto para ganhar cinco tentativas novas, para sempre.

## Histórico

Este projeto era Kotlin/Spring Boot e foi migrado para TypeScript. O plano, as decisões e o
porquê de cada escolha estão em `docs/migracao-typescript.md` e `docs/fase-0-spike.md`.
