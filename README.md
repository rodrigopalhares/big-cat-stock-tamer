# Gestão de Carteira de Ações Brasileiras

Aplicação web para acompanhamento de investimentos no mercado de renda variável brasileiro.
Permite cadastrar ativos, registrar compras e vendas, e visualizar o desempenho consolidado da
carteira com cotações via Yahoo Finance.

## Funcionalidades

- Cadastro de ativos: ações (STOCK), FIIs (REIT), ETFs, BDRs e Tesouro Direto
- Registro de transações de compra e venda com corretagem
- Cálculo automático de preço médio e posição atual
- Cálculo de lucro/prejuízo realizado e não realizado
- Cálculo de TIR mensal e anual (XIRR)
- Registro de proventos (dividendos, JCP, rendimentos) com IR retido
- Importação de transações e proventos em lote via CSV
- Cotações integradas ao Yahoo Finance e ao Tesouro Transparente
- Suporte a ativos em USD com conversão automática pelo PTAX do Banco Central
- Histórico de preços com backfill automático e atualização diária
- Evolução mensal da carteira com snapshots por ativo
- Métricas de risco (beta, alpha de Jensen, R²) contra o IBOVESPA
- Backup automático do banco, com rotação diária e mensal

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript 5.9 (Node 22+) |
| Servidor | Fastify 5 |
| Banco | SQLite (better-sqlite3) |
| ORM / migrations | Prisma 7 |
| Views | JSX renderizado no servidor (`preact-render-to-string`) |
| Front-end | HTMX + Bootstrap 5 + Chart.js |
| Validação | Zod |
| Scheduler | croner |
| Testes | Vitest + MSW |
| Lint / format | Biome + typescript-eslint + dependency-cruiser |

> Não há React no navegador: o HTML sai pronto do servidor e o HTMX cuida da interatividade.
> O JSX existe para o compilador conferir o que a rota passa para a view.

## Pré-requisitos

- Node 22+

```bash
# Recomendado: mise instala a versão certa automaticamente
mise install
```

## Primeira execução

```bash
npm install
cp .env.example .env        # ajuste se quiser senha ou outro diretório de dados
npm run db:deploy           # cria o banco e aplica as migrations
npm run db:seed             # opcional: dados de exemplo para navegar
npm run dev
```

A aplicação sobe em **http://localhost:8000**.

O banco é criado em `data/stocks.db`. Sem `APP_AUTH_PASSWORD` no `.env`, a autenticação fica
desabilitada e a aplicação abre direto.

## Comandos

```bash
npm run dev          # servidor com reload
npm run build        # compila o servidor e o JS de cliente
npm start            # roda o build

npm test             # testes
npm run typecheck    # verificação de tipos
npm run lint         # Biome + typescript-eslint + regras de camada + schema
npm run format       # corrige o estilo
npm run check        # tipos + lint + testes

npm run db:migrate   # cria e aplica migration (desenvolvimento)
npm run db:deploy    # aplica as migrations existentes
npm run db:seed      # popula com dados de exemplo
npm run db:studio    # GUI para inspecionar o banco
```

## Estrutura

```
prisma/
  schema.prisma          8 tabelas
  migrations/            SQL versionado
  seed.ts                dados de exemplo
src/
  main.ts                entrypoint
  app.ts                 monta a instância do Fastify (usado também nos testes)
  container.ts           instancia e liga os services
  config/                ambiente validado com Zod, conexão do banco
  domain/                funções puras: cálculo, XIRR, regressão, CSV, datas
  integrations/          clientes Yahoo, BCB e Tesouro
  modules/<feature>/     rota + service + schema + teste, juntos
  views/                 componentes JSX
  plugins/               auth, tratamento de erro, render
  infra/                 backup e scheduler
  client/                TypeScript de navegador → public/js/
tests/                   harness, fixtures e testes de integração
docs/                    plano e decisões da migração
```

## Configuração

Tudo por variável de ambiente, validada no boot (`src/config/env.ts`). Ver `.env.example`.

| Variável | Padrão | O que faz |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` ou `production` |
| `PORT` | `8000` | Porta do servidor |
| `APP_DATA_DIR` | `./data` | Base do banco, do backup e da sessão |
| `DATABASE_URL` | `file:./data/stocks.db` | Caminho do SQLite |
| `APP_AUTH_PASSWORD` | vazio | Senha de acesso; vazio desabilita a autenticação |
| `APP_AUTH_SESSION_DAYS` | `365` | Validade da sessão |
| `APP_AUTH_KEY_FILE` | `${APP_DATA_DIR}/auth.key` | Onde ficam os hashes de sessão |
| `APP_BACKUP_ENABLED` | `true` | Liga o backup automático |
| `APP_BACKUP_DIR` | `${APP_DATA_DIR}/backups` | Destino dos snapshots |
| `APP_BACKUP_DAILY_COPIES` | `7` | Backups diários mantidos |
| `APP_BACKUP_MONTHLY_COPIES` | `3` | Backups mensais mantidos |
| `LOG_LEVEL` | `info` | Nível de log |

Nenhuma delas precisa de um arquivo `.env` em produção — valem as variáveis do ambiente.

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/portfolio/` | Dashboard |
| GET | `/portfolio/api` | Resumo da carteira (JSON) |
| GET | `/portfolio/api/{ticker}` | Posição de um ativo (JSON) |
| POST | `/portfolio/update-prices` | Atualiza cotações |
| GET | `/assets/` · `/assets/{ticker}` | Lista e detalhe do ativo |
| GET/POST | `/assets/api` | Ativos (JSON) |
| GET | `/transactions/` | Transações |
| POST | `/transactions/parse-csv` · `/batch` | Importação em lote |
| GET/POST/DELETE | `/transactions/api` | Transações (JSON) |
| GET | `/dividends/` | Proventos |
| GET/POST/DELETE | `/dividends/api` | Proventos (JSON) |
| GET | `/evolution/` · `/evolution/api` | Evolução mensal |
| POST | `/evolution/recalculate` | Recalcula os snapshots |
| GET | `/risk-metrics/` | Beta, alpha e R² |
| GET/POST | `/login` · POST `/logout` | Autenticação |
| GET | `/health` | Verificação de saúde |

## Backup e restauração

Snapshot ao subir e às 00:05 (`America/Sao_Paulo`), em `data/backups/daily/` e
`data/backups/monthly/`. Usa `VACUUM INTO` do SQLite: cópia consistente mesmo com a aplicação
escrevendo.

```bash
# restaurar
# 1. pare a aplicação
gunzip -c data/backups/daily/stocks-2026-06-09.db.gz > data/stocks.db
# 2. suba de novo
```

## Serviço (systemd)

Em produção a aplicação roda como serviço, com auto-start amarrado ao volume criptografado:
um *path unit* vigia a sentinela `/storage/media/big-cat/.mounted` e sobe o serviço quando o
volume é montado; `BindsTo` derruba junto no `umount`. As units estão versionadas em
[`deploy/`](deploy/), com sandbox do systemd — um único caminho gravável, resto do sistema
read-only.

Instalação, isolamento e operação no dia a dia: [`deploy/README.md`](deploy/README.md).

Como `dist/` e `public/js/` não são versionados, atualizar código é sempre:

```bash
npm ci && npm run build
npm run db:deploy                        # se houver migration nova
sudo systemctl restart big-cat.service
```

## Migração do Kotlin

O projeto nasceu em Kotlin com Spring Boot e foi migrado para TypeScript. O plano completo,
as alternativas consideradas e o resultado do spike de validação estão em
[`docs/migracao-typescript.md`](docs/migracao-typescript.md) e
[`docs/fase-0-spike.md`](docs/fase-0-spike.md).
