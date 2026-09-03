# Roteiro de QA — validação de posição e tela de erro

Data: 03/09/2026. Cobre o que foi feito nesta rodada:

1. Venda ou agrupamento acima da posição é recusado (formulário, edição, API e lote do CSV).
2. Provento com valor bruto não positivo ou IR fora de faixa é recusado.
3. Página de erro com layout, mensagem em português e botão "Voltar"; erro de validação vira 400.

## Ambiente

- Servidor de QA em **http://localhost:3999**, sem senha (autenticação desligada só aqui).
- Banco: **cópia** em `data/qa/stocks.db`. Pode sujar à vontade; o banco real não é tocado.
- Subir de novo, se cair: `data/qa/start.sh` (log em `data/qa/server.log`). O cabeçalho do
  script diz como recriar a cópia do zero.
- Números de partida da cópia, para conferir depois: 513 transações, 2.059 proventos.
  ITUB3 tem 1.586 ações e a primeira compra é de 20/10/2021. ABEV3 tem 4.700.

Marque cada caso com `[x]` quando o resultado bater. Onde diz "nada gravado", confira o
contador do card "Histórico" na tela de Transações (deve continuar em 513, salvo onde o
roteiro manda criar algo).

---

## A. Venda acima da posição

### A1. Formulário — venda impossível
- [ ] Transações → "Nova Transação": Ticker `ITUB3`, Tipo **Venda**, Quantidade `999999`,
  Preço `40`, Data de hoje → Registrar.
- Esperado: página **"Erro 400 — Dados inválidos"** com a frase
  `Venda de 999.999 ITUB3 em 03/09/2026 supera a posição de 1.586 na data.` e o aviso
  "Nada foi gravado. Volte, corrija e envie de novo."
- [ ] Botão **Voltar** leva de volta para `/transactions/`. Histórico continua em 513.
- [ ] Dashboard: ITUB3 segue com 1.586 e os totais não mudaram (antes da correção esta venda
  entrava e o "Total Investido" virava negativo de milhões).

### A2. Formulário — venda com data anterior à compra
- [ ] Mesmo formulário: `ITUB3`, Venda, Quantidade `10`, Preço `40`, Data `01/01/2020`.
- Esperado: 400 com `... supera a posição de 0 na data.` (a primeira compra é de 20/10/2021,
  então em 2020 não havia nada para vender — mesmo havendo 1.586 hoje).

### A3. Formulário — venda que zera passa
- [ ] `ITUB3`, Venda, Quantidade `1586`, Preço `40`, Data de hoje → Registrar.
- Esperado: redireciona para a lista, a venda aparece no topo (Histórico 514). No dashboard,
  ITUB3 fica sem posição (some com o filtro "Apenas com posição" marcado).
- [ ] Apague essa venda pela lixeira da linha para voltar ao estado inicial (Histórico 513).

### A4. Agrupamento acima da posição
- [ ] `ITUB3`, Tipo **Agrupamento**, Quantidade `2000`, Data de hoje → Registrar.
- Esperado: 400 com `Agrupamento de 2.000 ITUB3 em 03/09/2026 supera a posição de 1.586 na data.`
  (o rótulo acompanha o tipo; não diz "Venda").

### A5. Edição — transformar a única compra em venda
- [ ] Abra `/assets/ITUB3`. Na tabela de transações, clique no lápis da compra de **900** de
  20/10/2021. No modal, troque o Tipo para **Venda** e salve.
- Esperado: 400 (`Venda de 900 ITUB3 em 20/10/2021 supera a posição de 0 na data.`) — a
  própria linha em edição sai da conta, e antes dela não havia nada. A linha continua como
  compra.

### A6. Edição — salvar a própria venda não a conta duas vezes
- [ ] Faça A3 de novo (venda de 1.586). Depois clique no lápis dessa venda, troque só o preço
  para `41` e salve.
- Esperado: salva normalmente (a venda não é comparada consigo mesma).
- [ ] Apague a venda para restaurar.

### A7. Redução de capital não conta como redução de quantidade
- [ ] `ITUB3`, Tipo **Redução de Capital**, Quantidade `1586`, Valor por Ação `1`, Data de hoje.
- Esperado: grava (302) e a quantidade de ITUB3 continua 1.586 no dashboard.
- [ ] Apague a linha depois.

### A8. API JSON
No terminal:

```bash
curl -s -X POST localhost:3999/transactions/api -H 'Content-Type: application/json' \
  -d '{"assetId":"ITUB3","type":"SELL","quantity":999999,"price":40,"date":"2026-09-03"}'
```
- [ ] Esperado: `{"error":"Venda de 999.999 ITUB3 em 03/09/2026 supera a posição de 1.586 na data."}`
  com status 400 (`-i` mostra o status).

```bash
curl -s -X POST localhost:3999/transactions/api -H 'Content-Type: application/json' \
  -d '{"assetId":"ITUB3","type":"XPTO","quantity":1,"price":1,"date":"2026-09-03"}'
```
- [ ] Esperado: 400 com `"details":["Tipo deve ser um destes: BUY, SELL, ..."]` — antes era
  500 com o array do Zod em inglês.

## B. Lote do CSV

Formato (separado por **tab**): `ticker  data  C/V  qtd  preço  taxas  corretora  irrf  moeda  notas`.
Se o editor trocar tab por espaço ao colar, monte as linhas numa planilha e copie de lá.

### B1. Venda acima da posição recusa o lote inteiro
- [ ] Transações → **Importar** → aba CSV, cole:

```
ITUB3	01/09/2026	C	10	40,00	0,00	XP	0	BRL	qa
ITUB3	02/09/2026	V	5000	40,00	0,00	XP	0	BRL	qa
```
- [ ] Processar → Próximo → Confirmar Importação (2 transações).
- Esperado: alerta vermelho **dentro do modal** com
  `Venda de 5.000 ITUB3 em 02/09/2026 supera a posição de 1.596 na data.` (1.586 + a compra
  de 10 do próprio lote). Feche o modal: Histórico continua em 513 — a compra válida do lote
  **também** não entrou, então reenviar depois de corrigir não duplica nada.

### B2. Compra e venda do mesmo dia entram em qualquer ordem
- [ ] Novo lote, com a venda **antes** da compra no texto:

```
ABEV3	01/09/2026	V	100	14,00	0,00	XP	0	BRL	qa
ABEV3	01/09/2026	C	100	14,00	0,00	XP	0	BRL	qa
```
- Esperado: importa as duas (Histórico 515). Na lista, para a mesma data, a **compra** tem id
  menor que a venda (foi gravada primeiro) — na tela, a venda aparece acima da compra.
- [ ] Apague as duas linhas de ABEV3 de 01/09/2026.

### B3. Lote normal continua funcionando
- [ ] Um lote só com compras (qualquer ticker existente) importa e redireciona para a lista.
  Apague depois.

## C. Proventos

### C1. IR retido maior que o bruto (edição)
- [ ] Proventos → na linha do ITUB3 de 21/07/2026 (BTC, R$ 30,46) clique no lápis. Em
  "IR Retido" digite `50` e salve.
- Esperado: 400 com `IR retido não pode superar o valor bruto`. O provento continua com IR 0.

### C2. Valor bruto negativo pelo lote
O formulário barra no navegador (`min`), então o caminho é o lote, que é o que a regra protege:

```bash
curl -s -X POST localhost:3999/dividends/batch -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"rows":[{"ticker":"ITUB3","date":"2026-09-01","type":"DIVIDENDO","totalAmount":-5,"taxWithheld":0,"currency":"BRL","broker":"","notes":""}]}'
```
- [ ] Esperado: `{"error":"Valor bruto deve ser maior que zero"}`, e a página de Proventos
  continua com 2.059.

### C3. Provento normal continua funcionando
- [ ] "Novo Provento": `ITUB3`, DIVIDENDO, Valor Bruto `10`, Data de hoje → Registrar. Grava
  e aparece no topo (2.060). Apague depois.

## D. Página de erro

### D1. Rota inexistente
- [ ] Abra `http://localhost:3999/nada`.
- Esperado: página com o menu, "Erro 404 — Não encontrado", "Esta página não existe.",
  botões **Voltar** e **Dashboard**. Sem JSON cru na tela.
- [ ] Como a URL foi digitada (sem página anterior), **Voltar** vai para o Dashboard.

### D2. Ativo inexistente
- [ ] Abra `http://localhost:3999/assets/NAOEXISTE`.
- Esperado: "Erro 404 — Não encontrado" com `Ativo não encontrado` (era "Asset not found").

### D3. Parâmetro inválido
- [ ] Abra `http://localhost:3999/transactions/notes/abc`.
- Esperado: "Erro 400 — Dados inválidos" com `Id de nota inválido`.

### D4. Erro de validação do Zod vira 400 legível
O navegador barra `abc` num campo numérico antes de enviar, então use o terminal:

```bash
curl -s -i -X POST localhost:3999/transactions/new \
  -d 'ticker=ITUB3&type=BUY&currency=BRL&quantity=abc&price=10&fees=0&date=2026-09-03' | head -c 1500
```
- [ ] Esperado: `HTTP/1.1 400`, HTML com `Dados inválidos`, `Quantidade deve ser um número` e
  `Nada foi gravado`. Antes: 500 com o array de issues em inglês.

### D5. "Voltar" volta para a tela de origem
- [ ] Repita A1 (venda de 999.999) e, na página de erro, clique em **Voltar**.
- Esperado: volta para `/transactions/` (a página de onde o formulário saiu).

### D6. Tema escuro
- [ ] Alterne o tema pelo ícone da lua/sol e abra `/nada` de novo.
- Esperado: a página de erro acompanha o tema (fundo escuro, texto legível).

### D7. Erro pelo HTMX continua no banner, não em página
- [ ] Alocação → no card **Fii**, no campo "Meta", digite `-5` e saia do campo (Tab).
- Esperado: a tela **não** navega para a página de erro; aparece o texto vermelho
  `Meta não pode ser negativa` no topo, e a meta continua 18.
- [ ] Aviso: o campo aceita o valor visualmente; recarregue a página para ver que nada mudou.

### D8. API continua JSON
- [ ] `curl -s localhost:3999/assets/api/NAOEXISTE` → `{"error":"Ativo não encontrado"}`.

## E. Regressão rápida

- [ ] Compra normal pelo formulário grava e redireciona; a linha aparece no topo.
- [ ] Editar uma transação sem mexer na quantidade salva sem erro.
- [ ] Dashboard, Ativos, Alocação, Proventos, Evolução e Risk Metrics abrem sem erro.
- [ ] No final, o Histórico está em 513 e Proventos em 2.059 (se apagou o que criou).

## F. Fase 1 — feedback e rótulos

- [ ] Menu diz **Risco** (não "Risk Metrics"); a página abre como "Métricas de Risco" e o
  card diz "Última atualização" com acento. A navbar não mostra mais "Fastify + TypeScript".
- [ ] Títulos de aba terminam em "— Carteira" em todas as telas.
- [ ] Badges e selects de tipo de ativo estão em português: "Ação", "FII", "Tesouro Direto",
  "Renda Fixa". Passe o mouse num badge: o `title` mostra o código (`TESOURO_DIRETO`).
- [ ] Legenda dos dois gráficos do dashboard também em português.
- [ ] Transações: os filtros dizem **Tipo de ativo** e **Operação**. Escolha "Venda" em
  Operação → só vendas na lista; a URL ganha `operation=SELL`.
- [ ] Proventos: filtros dizem **Tipo de ativo** e **Provento**.
- [ ] Evolução → **Recalcular**: o botão vira "Recalculando..." com spinner, a página segue
  responsiva, e recarrega sozinha ao terminar (~1 min). Nada de aba travada.
- [ ] Dashboard sem snapshot (cópia recém-criada, antes de recalcular): no lugar do gráfico
  aparece um card explicando e com o mesmo botão Recalcular.

## G. Fase 2 — listas grandes

- [ ] Transações abre com 100 linhas e o badge "Histórico" mostra o total (513). Role até o
  fim: aparece "Carregando mais..." e as próximas 100 entram sem recarregar a página. Repita
  até acabar — a última página não tem sentinela.
- [ ] Com filtro (ex.: Tipo de ativo = FII), a rolagem continua respeitando o filtro.
- [ ] Busca: digite `itub` e Enter → só ITUB3/ITUB4; o campo fica preenchido em maiúsculas;
  o X limpa tudo.
- [ ] Ano: escolha 2026 → só lançamentos de 2026; combina com a busca.
- [ ] Proventos: mesma rolagem; o cabeçalho mostra "R$ X líquidos" de **tudo** que o filtro
  pegou (mude o ano e veja o valor mudar). Com 2.059 linhas a página abre rápido.
- [ ] Evolução: gráfico em cima; a tabela começa no mês mais recente; só ativos com posição
  têm coluna; rolagem carrega 36 meses por vez.
- [ ] Editar e excluir uma linha carregada pela rolagem (além da página 1) funciona normalmente.

## H. Fase 3 — tabela de posições e celular

- [ ] Dashboard: a tabela rola dentro da própria área; cabeçalho e coluna do ticker ficam
  fixos ao rolar (vertical e horizontal); a linha Total gruda embaixo.
- [ ] Moeda e TIR/mês começam escondidas; "Colunas extras" mostra as duas e a escolha
  sobrevive a um F5.
- [ ] Depois de cada grupo de tipo há uma linha "Subtotal Ação · N ativos" com custo, valor,
  lucro, proventos e TIR do grupo. Filtrar por tipo mantém só o subtotal daquele tipo; ordenar
  por qualquer coluna esconde os subtotais.
- [ ] Ordenação por coluna continua funcionando (clique em "Valor Atual").
- [ ] Celular (ou janela com ~400px): cards do resumo em duas colunas; em Transações,
  Proventos e Ativos o formulário começa recolhido e o botão "Nova/Novo" no topo abre-o. No
  desktop (≥ 992px) o formulário aparece direto, sem botão.

## I. Fase 4 — exclusão e acessibilidade

- [ ] Ativos: as linhas têm só "Ver transações" e "Editar", lado a lado; não há lixeira.
- [ ] Editar um ativo com lançamentos → no rodapé do modal, à esquerda, **Excluir**. O
  confirm diz "Excluir PETR4? Somem junto N transações e M proventos. Não dá para desfazer."
  com os números certos. Cancele.
- [ ] Ativo sem lançamentos: o confirm diz "Ele não tem transações nem proventos."
- [ ] Confirme a exclusão de um ativo de teste criado para isso → volta para a lista sem ele.
- [ ] Importar CSV (transações e proventos): "Preencher com um exemplo" põe três linhas no
  textarea, com tabs; "Baixar modelo (.tsv)" baixa o arquivo. Processar o exemplo funciona
  (PETR4 existe; VOO pode aparecer como novo).
- [ ] Clique num rótulo de campo (ex.: "Quantidade") → o foco vai para o campo. Vale para os
  formulários de transação, provento, ativo e para os modais.
- [ ] Com leitor de tela ou inspecionando: os botões de lápis e lixeira têm `aria-label`
  ("Editar transação", "Excluir provento"…), assim como o botão de tema e o de sair.

## Se algo falhar

Anote o caso (A1, B2…), o que apareceu na tela e, se for erro 500, o trecho de
`data/qa/server.log` com "erro não tratado". A cópia pode ser refeita a qualquer hora com os
dois comandos do cabeçalho de `data/qa/start.sh`.
