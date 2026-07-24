# Plano de Migração — Kotlin/Spring Boot → TypeScript/Node

Documento de referência para a migração completa da aplicação. Escrito em 2026-07-24.

---

## 1. Escopo

| Área | Volume atual |
|---|---|
| Kotlin `main` | 44 arquivos, 5.556 linhas |
| Kotlin `test` | 24 arquivos, 4.765 linhas, **300 testes** |
| Templates Thymeleaf | 13 arquivos, 2.270 linhas |
| JS de cliente | 6 arquivos, 652 linhas |
| Migrations Flyway | 13 arquivos, 8 tabelas |
| Fixtures de teste | 11 arquivos (JSON/CSV) |

Tudo migra. O resultado final não tem Gradle, JVM nem Kotlin no repositório.

**Não há migração de dados.** Não existe banco em produção para transportar — o SQLite nasce vazio, criado pela migration inicial. Isso elimina a fase de ETL e muda o critério de aceitação: a prova de que a migração está correta são os **300 testes portados**, não a comparação de resultados contra um banco existente.

---

## 2. Stack

| Camada | Hoje | Depois |
|---|---|---|
| Linguagem | Kotlin 2.3 / JDK 21 | TypeScript 5.x / Node 22 LTS |
| Runtime web | Spring Boot 4 (MVC) | **Fastify 5** |
| Banco | H2 file-based | **SQLite** (`better-sqlite3` via Prisma) |
| Acesso a dados | Exposed (DAO + DSL) | **Prisma** |
| Migrations | Flyway | **Prisma Migrate** |
| Templates | Thymeleaf | **JSX SSR** (`preact-render-to-string`) |
| Validação | jakarta.validation | **Zod** |
| HTTP client | Spring RestClient | `fetch` nativo (undici) |
| CSV | kotlin-csv-jvm | `papaparse` |
| Scheduler | Spring `@Scheduled` | **`croner`** (suporta `America/Sao_Paulo`) |
| DI | Spring container | Composition root manual (`container.ts`) |
| Testes | Kotest + MockK + MockMvc | **Vitest** + `app.inject()` + **MSW** |
| Lint/format | ktlint | **Biome** |
| Build/tasks | Gradle | `package.json` scripts + `.mise.toml` |
| Bundle do cliente | — | `esbuild` (só para `src/client/`) |

Front-end **não muda**: HTMX, Bootstrap 5 e Chart.js continuam vindo de CDN, e o servidor continua devolvendo HTML.

---

## 3. Decisões técnicas críticas

Estas cinco decisões afetam todo o código e devem ser respeitadas sem exceção.

### 3.1. Datas: `LocalDate` vira `string` ISO, não `Date`

**O Prisma não tem tipo "data sem hora".** O `DateTime` dele é sempre um instante com timezone, e o JS `Date` arrasta o fuso do processo. Como a aplicação inteira gira em torno de datas de pregão em `America/Sao_Paulo`, usar `DateTime` para essas colunas produziria o clássico bug de "a transação do dia 1º aparece no dia 31 do mês anterior".

**Regra:** toda coluna que hoje é `LocalDate` vira `String` no Prisma, no formato `YYYY-MM-DD`.

Colunas afetadas: `transactions.date`, `price_history.date`, `dividends.date`, `monthly_snapshots.month`, `exchange_rates.date`, `benchmark_prices.month`, `risk_metrics.calculated_at`.

Isso é estritamente melhor que o status quo em três aspectos: ordena e compara corretamente em SQL (`WHERE date >= '2024-01-01'`, `ORDER BY date`), é comparável com `===`, e é serializável em JSON sem conversão.

Para não confundir com string qualquer, usamos um **branded type**:

```ts
// src/shared/iso-date.ts
declare const brand: unique symbol
export type IsoDate = string & { readonly [brand]: 'IsoDate' }

export function isoDate(value: string): IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Data inválida: ${value}`)
  return value as IsoDate
}
export function today(tz = 'America/Sao_Paulo'): IsoDate { /* ... */ }
export function addDays(d: IsoDate, n: number): IsoDate { /* ... */ }
export function daysBetween(a: IsoDate, b: IsoDate): number { /* ... */ }
export function yearMonth(d: IsoDate): string        // '2024-01'  (o YearMonth do Kotlin)
export function firstDayOfMonth(ym: string): IsoDate
```

Aritmética de datas com `date-fns` internamente, nunca expondo `Date` para fora do módulo.

As colunas `created_at` continuam `DateTime` — são instantes de verdade.

### 3.2. Tudo que toca o banco é `async`

Consequência direta da escolha do Prisma (não há client síncrono). A propagação é previsível:

- **Continua síncrono:** todo o `src/domain/` — cálculo de posição, IRR, XIRR, regressão linear, classificação de ticker, parsing de CSV, política de retenção de backup. São funções puras sem I/O. É onde mora a corretude financeira e onde estão a maioria dos testes.
- **Vira `async`:** os services (`asset`, `transaction`, `dividend`, `portfolio`, `evolution`, `price-history`, `exchange-rate`, `risk`), as rotas e os testes correspondentes.

**Regra:** funções puras nunca recebem `PrismaClient`. Se uma função precisa de `await`, ela não pertence a `src/domain/`.

### 3.3. Transações: nada de rede dentro delas

O SQLite tem **um único escritor**. Uma transação aberta bloqueia toda escrita concorrente, e o `$transaction` interativo do Prisma tem timeout padrão de 5 s.

Hoje existem trechos que intercalam chamada HTTP e escrita (`ExchangeRateService.backfill`, `PriceHistoryService`, `BenchmarkService`). Eles funcionam porque cada escrita abre sua própria transação — esse comportamento **deve ser preservado**.

**Regra:** dentro de `prisma.$transaction()` só entram operações de banco. Busque na rede antes, escreva depois.

```ts
// ✅ correto
const quotes = await yahoo.fetchQuotes(tickers)          // rede, fora da transação
await prisma.$transaction(async (tx) => {                // só banco
  for (const q of quotes) await tx.priceHistory.upsert({ ... })
})

// ❌ errado — segura o lock de escrita durante a latência da rede
await prisma.$transaction(async (tx) => {
  for (const t of tickers) {
    const q = await yahoo.fetchQuote(t)
    await tx.priceHistory.upsert({ ... })
  }
})
```

### 3.4. Precisão numérica não muda

`Double` do Kotlin e `number` do JS são ambos IEEE-754 binary64. `Float` do Prisma em SQLite é `REAL`, também binary64. **Os resultados dos cálculos ficam bit-a-bit idênticos**, e os testes que hoje comparam com `plusOrMinus(0.001)` portam sem reavaliação.

**Regra:** não trocar `Float` por `Decimal` durante a migração. Se um dia quiser precisão decimal, é outro projeto, com sua própria bateria de validação.

### 3.5. Backup: `BACKUP TO` vira `VACUUM INTO`

O `VACUUM INTO 'arquivo.db'` do SQLite é o equivalente exato do `BACKUP TO` do H2 — snapshot online, transacionalmente consistente, seguro com o app escrevendo. Mesma estratégia atual: escreve em `.tmp` e faz rename atômico.

Duas diferenças a tratar:
- O `VACUUM` **não pode rodar dentro de transação** → executar via `$executeRawUnsafe` fora de qualquer `$transaction`.
- O H2 gerava `.zip`; o `VACUUM INTO` gera um `.db` cru. Comprimir com `node:zlib` para manter o formato `.zip` e a nomenclatura atual (`daily/stocks-2026-07-24.zip`).

O `BackupRetention` (política pura, já isolada) porta linha a linha para `src/domain/backup-retention.ts` sem mudança de lógica.

---

## 4. Estrutura de pastas

```
stocks/
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── .mise.toml                        # node = "22", tasks run/build/test/lint/format
├── .env.example
│
├── prisma/
│   ├── schema.prisma                 # substitui os 8 arquivos de model/
│   ├── migrations/
│   │   └── 20260724000000_init/migration.sql
│   ├── seed.ts                       # dados de exemplo para dev local
│   └── legacy-flyway/                # as 13 migrations antigas, só referência
│
├── public/                           # era src/main/resources/static/
│   ├── css/custom.css
│   ├── js/                           # gerado pelo esbuild — não editar
│   ├── favicon.ico
│   └── logo.png
│
├── src/
│   ├── main.ts                       # entrypoint: monta container, sobe servidor
│   ├── app.ts                        # constrói a instância Fastify (testável)
│   ├── container.ts                  # composition root — instancia todos os services
│   │
│   ├── config/
│   │   ├── env.ts                    # schema Zod do ambiente (era application.yml)
│   │   ├── db.ts                     # PrismaClient + pragmas WAL/foreign_keys
│   │   └── logger.ts
│   │
│   ├── plugins/                      # era config/ do Spring
│   │   ├── auth.ts                   # AuthFilter → hook onRequest
│   │   ├── request-log.ts            # requestLoggingFilter do WebConfig
│   │   ├── errors.ts                 # HttpError → resposta HTML ou JSON
│   │   └── static.ts
│   │
│   ├── domain/                       # PURO. sem I/O, sem Prisma, sem fetch.
│   │   ├── calculation.ts            # calculatePosition, buildCashFlows, PnL
│   │   ├── xirr.ts                   # IRR (Newton-Raphson) e XIRR (bisseção)
│   │   ├── regression.ts             # beta, alpha, r² do RiskMetricsService
│   │   ├── evolution.ts              # montagem dos snapshots mensais
│   │   ├── ticker-classification.ts
│   │   ├── backup-retention.ts
│   │   ├── csv/
│   │   │   ├── transaction-csv.ts    # parsing puro (linha → CsvRow)
│   │   │   ├── dividend-csv.ts
│   │   │   └── br-number.ts          # parseBrazilianNumber
│   │   └── constants.ts              # ASSET_TYPES, DIVIDEND_TYPES, aliases…
│   │
│   ├── integrations/                 # clientes HTTP externos
│   │   ├── http.ts                   # wrapper de fetch: timeout, UA, log
│   │   ├── yahoo/
│   │   │   ├── yahoo.client.ts
│   │   │   └── yahoo.schema.ts       # Zod da resposta da API
│   │   ├── bcb/
│   │   │   ├── bcb.client.ts
│   │   │   └── bcb.schema.ts
│   │   └── tesouro/
│   │       └── tesouro.client.ts     # CSV do Tesouro Direto + cache
│   │
│   ├── modules/                      # uma pasta por feature
│   │   ├── asset/
│   │   │   ├── asset.routes.ts       # era AssetController
│   │   │   ├── asset.service.ts      # era AssetService
│   │   │   ├── asset.schema.ts       # era AssetDtos (Zod + tipos)
│   │   │   └── asset.service.test.ts
│   │   ├── transaction/
│   │   ├── dividend/
│   │   ├── portfolio/
│   │   ├── evolution/
│   │   ├── price-history/
│   │   ├── exchange-rate/
│   │   ├── risk/                     # benchmark + risk-metrics
│   │   ├── csv-import/
│   │   └── auth/
│   │
│   ├── views/                        # era resources/templates/
│   │   ├── layout.tsx                # base.html (head, navbar, scripts)
│   │   ├── components/
│   │   │   ├── badge.tsx
│   │   │   ├── money.tsx
│   │   │   └── ticker-info.tsx       # o HTML-em-string dos controllers
│   │   ├── pages/
│   │   │   ├── dashboard.tsx
│   │   │   ├── assets.tsx
│   │   │   ├── asset-detail.tsx
│   │   │   ├── transactions.tsx
│   │   │   ├── dividends.tsx
│   │   │   ├── evolution.tsx
│   │   │   ├── risk-metrics.tsx
│   │   │   └── login.tsx
│   │   └── partials/                 # respostas HTMX
│   │       ├── csv-preview.tsx
│   │       ├── csv-asset-review.tsx
│   │       └── dividend-csv-preview.tsx
│   │
│   ├── client/                       # TS de navegador → esbuild → public/js/
│   │   ├── transactions.ts
│   │   ├── dividends.ts
│   │   ├── dashboard.ts
│   │   ├── dashboard-table.ts
│   │   ├── format.ts
│   │   └── theme.ts
│   │
│   ├── infra/
│   │   ├── backup.ts                 # VACUUM INTO + rotação
│   │   └── scheduler.ts              # croner (era SchedulerConfig)
│   │
│   └── shared/
│       ├── iso-date.ts
│       ├── http-error.ts             # era ResponseStatusException
│       └── format.ts                 # formatação BRL/USD compartilhada
│
└── tests/
    ├── setup.ts                      # banco de teste por worker, MSW
    ├── factories.ts                  # era TestDataBuilders.kt
    ├── fixtures/                      # os 11 JSON/CSV atuais, sem alteração
    └── integration/                  # testes de rota (app.inject)
```

### Por que módulos por feature e não camadas globais

O layout atual (`controller/`, `service/`, `dto/`, `model/`) obriga a abrir quatro pastas para mexer numa feature. Com `modules/asset/` tudo que é de ativo fica junto, e o teste fica ao lado do arquivo testado. O que **não** é de feature — cálculo puro, clientes HTTP, plugins — sai para pastas próprias, o que também torna a regra de dependência visível.

---

## 5. Padrões por camada

### Regras de dependência (verificáveis com `dependency-cruiser` no CI)

```
routes  →  service  →  domain
   ↓          ↓
 views    integrations
              ↓
           domain
```

- `domain/` **não importa nada** de `modules/`, `integrations/`, `config/` ou `@prisma/client`.
- `views/` não importa service nem Prisma — recebe tudo por props.
- `integrations/` não importa Prisma — devolve dados, não persiste.
- `routes` não contém lógica de negócio: valida, chama um service, escolhe a resposta.

### `domain/` — funções, não classes

O `CalculationService` não tem estado nem dependência; é uma classe só porque o Spring exige um bean. Em TS vira módulo de funções exportadas:

```ts
// src/domain/calculation.ts
export type TransactionData = {
  type: 'BUY' | 'SELL'
  quantity: number
  price: number
  fees: number
  date: IsoDate
  priceBrl: number
  feesBrl: number
}

export type PositionCalcResult = { /* ... */ }

export function calculatePosition(txs: readonly TransactionData[]): PositionCalcResult { /* ... */ }
export function calculateXirr(flows: CashFlow[], currentValue?: number): number | null { /* ... */ }
```

Ganho colateral: `type: 'BUY' | 'SELL'` é union type. Hoje é `String` e nada impede `type = "COMPRA"`.

### `service/` — classe com injeção por construtor

Mantém o formato atual, que é bom e testável:

```ts
export class AssetService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly quotes: YahooClient,
  ) {}

  async findById(ticker: string): Promise<Asset | null> {
    return this.prisma.asset.findUnique({ where: { ticker: ticker.toUpperCase() } })
  }
}
```

Sem decorators, sem container. O wiring fica num arquivo:

```ts
// src/container.ts
export function buildContainer(prisma: PrismaClient, env: Env) {
  const yahoo = new YahooClient(env)
  const bcb = new BcbClient(env)
  const exchangeRate = new ExchangeRateService(prisma, bcb)
  const asset = new AssetService(prisma, yahoo)
  const transaction = new TransactionService(prisma, asset, exchangeRate)
  // ...
  return { asset, transaction, exchangeRate, /* ... */ } as const
}
export type Container = ReturnType<typeof buildContainer>
```

Vinte linhas explícitas substituem o container do Spring. Em teste, monta-se o mesmo container com um Prisma apontando para o banco temporário.

### `routes/` — plugin Fastify por módulo

```ts
export const assetRoutes: FastifyPluginAsync<{ c: Container }> = async (app, { c }) => {
  app.get('/assets/', async (req, reply) => {
    const q = ListAssetsQuery.parse(req.query)
    const assets = await c.asset.findFiltered(q)
    return reply.html(<AssetsPage assets={assets} selected={q} />)
  })

  app.post('/assets/api', async (req, reply) => {
    const body = AssetRequest.parse(req.body)
    return reply.code(201).send(await c.asset.create(body))
  })
}
```

### `schema.ts` — Zod é a fonte única de DTO

Substitui os 9 arquivos de `dto/` **e** a validação `jakarta`. O tipo sai do schema, nunca duplicado:

```ts
export const AssetRequest = z.object({
  ticker:   z.string().min(1).transform(s => s.trim().toUpperCase()),
  yfTicker: z.string().nullish(),
  name:     z.string().nullish(),
  type:     z.enum(ASSET_TYPES).default('STOCK'),
  currency: z.enum(['BRL', 'USD']).default('BRL'),
})
export type AssetRequest = z.infer<typeof AssetRequest>
```

O `normalizedTicker()` e o `validate()` do `AssetRequest` atual viram `transform` e `enum` — a normalização passa a acontecer na fronteira, não espalhada pelos services.

### `views/` — componente é função com props tipadas

```tsx
export function AssetRow({ asset }: { asset: AssetView }) {
  return (
    <tr>
      <td><a href={`/assets/${asset.ticker}`}>{asset.ticker}</a></td>
      <td class="text-end">{money(asset.avgPrice, asset.currency)}</td>
      {asset.delisted && <Badge kind="warn">deslistado</Badge>}
    </tr>
  )
}
```

Os fragments Thymeleaf viram componentes; os partials HTMX são componentes devolvidos direto pela rota. O HTML montado com string template nos controllers (`AssetController.tickerInfo`, `TransactionController.tickerInfo` — cerca de 80 linhas de concatenação, incluindo `hx-swap-oob`) vira `views/components/ticker-info.tsx`, com escaping automático.

Helper de resposta:

```ts
// src/plugins/views.ts
app.decorateReply('html', function (node: VNode) {
  return this.type('text/html; charset=utf-8').send('<!DOCTYPE html>' + renderToString(node))
})
```

### Convenções gerais

- Arquivos em `kebab-case`; sufixos `.service.ts`, `.routes.ts`, `.schema.ts`, `.test.ts`, `.tsx` para views.
- **Sem `export default`** — sempre nomeado, para grep e refactor funcionarem.
- `tsconfig`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`.
- **`any` proibido**; `unknown` + validação Zod na fronteira externa.
- Erros de aplicação via `HttpError` (`new HttpError(404, 'Asset not found')`), tratados num único `setErrorHandler` que decide entre página HTML e JSON pelo `Accept`/`HX-Request`.
- Código em inglês; UI em português (mantém a regra atual do `CLAUDE.md`).

---

## 6. Schema Prisma

Tradução direta dos 8 modelos Exposed. Nomes de coluna preservados em `snake_case` via `@map`, para o SQL continuar reconhecível e o diff contra as migrations Flyway antigas ser legível durante o porte.

> **Oportunidade descartada de propósito.** Sem dados para preservar, este seria o momento barato de limpar o schema — `assets.type` e `assets.name` são `nullable` sem motivo, os `type`/`currency` poderiam virar `enum` do Prisma com CHECK constraint no banco, e `transactions.type` é redundante com o sinal de `quantity`. Deixei de fora: misturar redesenho de schema com troca de linguagem tira o principal apoio da migração, que é poder afirmar "o comportamento é o mesmo". Vale abrir como trabalho separado **depois** que a suíte de testes estiver verde em TypeScript — aí cada mudança de schema é validada pelos testes que já existem.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")     // file:../data/stocks.db
}

model Asset {
  ticker         String   @id
  yfTicker       String?  @map("yf_ticker")
  name           String?
  type           String?
  currency       String   @default("BRL")
  delisted       Boolean  @default(false)
  hasPosition    Boolean  @default(false) @map("has_position")
  quantity       Float    @default(0)
  avgPrice       Float    @default(0) @map("avg_price")
  avgPriceBrl    Float    @default(0) @map("avg_price_brl")
  totalCost      Float    @default(0) @map("total_cost")
  totalCostBrl   Float    @default(0) @map("total_cost_brl")
  realizedPnl    Float    @default(0) @map("realized_pnl")
  realizedPnlBrl Float    @default(0) @map("realized_pnl_brl")
  createdAt      DateTime @default(now()) @map("created_at")

  transactions     Transaction[]
  dividends        Dividend[]
  priceHistory     PriceHistory[]
  monthlySnapshots MonthlySnapshot[]

  @@map("assets")
}

model Transaction {
  id        Int      @id @default(autoincrement())
  assetId   String   @map("asset_id")
  type      String
  quantity  Float
  price     Float
  fees      Float    @default(0)
  priceBrl  Float    @default(0) @map("price_brl")
  feesBrl   Float    @default(0) @map("fees_brl")
  currency  String   @default("BRL")
  date      String                            // ISO YYYY-MM-DD — ver §3.1
  broker    String?
  notes     String?
  createdAt DateTime @default(now()) @map("created_at")

  asset Asset @relation(fields: [assetId], references: [ticker], onDelete: Cascade)

  @@index([assetId])
  @@map("transactions")
}

model Dividend {
  id             Int      @id @default(autoincrement())
  assetId        String   @map("asset_id")
  type           String
  date           String
  totalAmount    Float    @map("total_amount")
  taxWithheld    Float    @default(0) @map("tax_withheld")
  totalAmountBrl Float    @default(0) @map("total_amount_brl")
  taxWithheldBrl Float    @default(0) @map("tax_withheld_brl")
  broker         String?
  currency       String   @default("BRL")
  notes          String?
  createdAt      DateTime @default(now()) @map("created_at")

  asset Asset @relation(fields: [assetId], references: [ticker], onDelete: Cascade)

  @@index([assetId])
  @@map("dividends")
}

model PriceHistory {
  id        Int      @id @default(autoincrement())
  assetId   String   @map("asset_id")
  date      String
  close     Float
  createdAt DateTime @default(now()) @map("created_at")

  asset Asset @relation(fields: [assetId], references: [ticker], onDelete: Cascade)

  @@unique([assetId, date], map: "uq_price_history_asset_date")
  @@map("price_history")
}

model MonthlySnapshot {
  id                      Int      @id @default(autoincrement())
  assetId                 String   @map("asset_id")
  month                   String
  quantity                Float
  avgPrice                Float    @map("avg_price")
  marketPrice             Float    @map("market_price")
  totalCost               Float    @map("total_cost")
  marketValue             Float    @map("market_value")
  accumulatedNetDividends Float    @default(0) @map("accumulated_net_dividends")
  createdAt               DateTime @default(now()) @map("created_at")

  asset Asset @relation(fields: [assetId], references: [ticker], onDelete: Cascade)

  @@unique([assetId, month], map: "uq_monthly_snapshot_asset_month")
  @@map("monthly_snapshots")
}

model ExchangeRate {
  id           Int      @id @default(autoincrement())
  date         String
  fromCurrency String   @map("from_currency")
  toCurrency   String   @map("to_currency")
  buyRate      Float    @map("buy_rate")
  sellRate     Float    @map("sell_rate")
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([date, fromCurrency, toCurrency], map: "uq_exchange_rate_date_pair")
  @@map("exchange_rates")
}

model BenchmarkPrice {
  id        Int      @id @default(autoincrement())
  ticker    String
  month     String
  close     Float
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([ticker, month], map: "uq_benchmark_ticker_month")
  @@map("benchmark_prices")
}

model RiskMetric {
  id           Int      @id @default(autoincrement())
  ticker       String
  calculatedAt String   @map("calculated_at")
  beta         Float?
  alpha        Float?
  rSquared     Float?   @map("r_squared")
  dataPoints   Int      @map("data_points")
  cdiAnnual    Float?   @map("cdi_annual")
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([ticker, calculatedAt], map: "uq_risk_metrics_ticker_date")
  @@map("risk_metrics")
}
```

**Migrations:** as 13 do Flyway são colapsadas numa única `init` gerada pelo `prisma migrate dev`. Não há banco existente para fazer replay, então o histórico não tem valor nenhum. Os SQL antigos ficam em `prisma/legacy-flyway/` só para consulta durante o porte, e podem ser apagados no fim.

**Pragmas** (aplicados no boot, em `src/config/db.ts`): `journal_mode = WAL` e `foreign_keys = ON`. O segundo é obrigatório — sem ele o SQLite ignora silenciosamente os quatro `ON DELETE CASCADE`, e `AssetService.delete()` deixaria órfãos.

---

## 7. Mapeamento arquivo a arquivo

### Entrypoint e config

| Kotlin | TypeScript |
|---|---|
| `StocksApplication.kt` | `src/main.ts` + `src/app.ts` |
| `config/WebConfig.kt` | `src/app.ts` (redirect `/` → `/portfolio/`) + `src/plugins/request-log.ts` |
| `config/AuthFilter.kt` | `src/plugins/auth.ts` (hook `onRequest`) |
| `config/HttpClientConfig.kt` | `src/integrations/http.ts` |
| `config/SchedulerConfig.kt` | `src/infra/scheduler.ts` |
| `resources/application.yml` | `src/config/env.ts` (Zod) + `.env` |

O `GlobalModelAttributes` (que injeta `requestURI` em toda view) some: o layout JSX recebe `path` como prop explícita.

### Models → Prisma

Os 8 arquivos de `model/` (Asset, Transaction, Dividend, PriceHistory, MonthlySnapshot, ExchangeRate, BenchmarkPrice, RiskMetric) colapsam em **um** `prisma/schema.prisma`. Os tipos que hoje são `*Entity` passam a ser gerados pelo Prisma.

### DTOs → schemas Zod

| Kotlin | TypeScript |
|---|---|
| `dto/Constants.kt` | `src/domain/constants.ts` |
| `dto/AssetDtos.kt` | `src/modules/asset/asset.schema.ts` |
| `dto/TransactionDtos.kt` | `src/modules/transaction/transaction.schema.ts` |
| `dto/DividendDtos.kt` | `src/modules/dividend/dividend.schema.ts` |
| `dto/PortfolioDtos.kt` | `src/modules/portfolio/portfolio.schema.ts` |
| `dto/MonthlyEvolutionDtos.kt` | `src/modules/evolution/evolution.schema.ts` |
| `dto/CsvBatchDtos.kt` | `src/modules/csv-import/csv.schema.ts` |
| `dto/YahooFinanceDtos.kt` | `src/integrations/yahoo/yahoo.schema.ts` |
| `dto/BcbDtos.kt` | `src/integrations/bcb/bcb.schema.ts` |

As funções de extensão `toResponse()` viram funções `toView()` no módulo correspondente.

### Services

| Kotlin | TypeScript | Observação |
|---|---|---|
| `CalculationService.kt` (244) | `domain/calculation.ts` + `domain/xirr.ts` | **puro, síncrono** |
| `TickerClassification.kt` (71) | `domain/ticker-classification.ts` | **puro** |
| `BackupRetention.kt` | `domain/backup-retention.ts` | **puro** |
| `CsvParsingService.kt` (304) | `domain/csv/transaction-csv.ts` (parse) + `modules/csv-import/transaction-csv.service.ts` (I/O) | **separar puro de I/O** |
| `DividendCsvParsingService.kt` (140) | `domain/csv/dividend-csv.ts` + `modules/csv-import/dividend-csv.service.ts` | idem |
| `RiskMetricsService.kt` (308) | `domain/regression.ts` (beta/alpha/r²) + `modules/risk/risk-metrics.service.ts` | idem |
| `MonthlyEvolutionService.kt` (269) | `domain/evolution.ts` + `modules/evolution/evolution.service.ts` | idem |
| `PriceHistoryService.kt` (308) | `domain/price-history.ts` + `modules/price-history/price-history.service.ts` | já tem funções puras |
| `QuoteService.kt` (384) | `integrations/yahoo/yahoo.client.ts` + `integrations/tesouro/tesouro.client.ts` + `integrations/cache.ts` | **quebrar em 3** — hoje mistura Yahoo, Tesouro e cache |
| `AssetService.kt` (216) | `modules/asset/asset.service.ts` | |
| `TransactionService.kt` (326) | `modules/transaction/transaction.service.ts` | |
| `DividendService.kt` (130) | `modules/dividend/dividend.service.ts` | |
| `PortfolioService.kt` (225) | `modules/portfolio/portfolio.service.ts` | **corrigir N+1** |
| `ExchangeRateService.kt` (130) | `modules/exchange-rate/exchange-rate.service.ts` | |
| `BenchmarkService.kt` (114) | `modules/risk/benchmark.service.ts` | |
| `BcbPtaxClient.kt` (55) | `integrations/bcb/bcb.client.ts` | |
| `AuthService.kt` (122) | `modules/auth/auth.service.ts` | `node:crypto` |
| `BackupService.kt` (105) | `infra/backup.ts` | `VACUUM INTO` |

**Duas melhorias aproveitando a migração** (não são refactor gratuito — são correções de defeito):

1. **N+1 no portfolio.** `PortfolioController.kt:40` e `:117` fazem `assets.forEach { it.transactions.toList() }` só para aquecer o lazy loading do DAO — 61 queries para 60 ativos. Com `include: { transactions: true }` vira 2. Mesma coisa em `PriceHistoryService` e `RiskMetricsService`.
2. **Quebrar o `QuoteService`.** 384 linhas com três responsabilidades e quatro campos `@Volatile` de cache. Como Yahoo e Tesouro já são mockados separadamente nos testes, a divisão é natural.

Nada além disso muda de comportamento. Toda outra diferença de resultado é bug de migração.

### Controllers → routes

| Kotlin | TypeScript |
|---|---|
| `AssetController.kt` (250) | `modules/asset/asset.routes.ts` |
| `TransactionController.kt` (330) | `modules/transaction/transaction.routes.ts` + `modules/csv-import/csv.routes.ts` |
| `DividendController.kt` (271) | `modules/dividend/dividend.routes.ts` |
| `PortfolioController.kt` (189) | `modules/portfolio/portfolio.routes.ts` |
| `MonthlyEvolutionController.kt` | `modules/evolution/evolution.routes.ts` |
| `RiskMetricsController.kt` | `modules/risk/risk.routes.ts` |
| `AuthController.kt` (63) | `modules/auth/auth.routes.ts` |

As `*TemplateData` aninhadas nos controllers (ex.: `TransactionController.TransactionTemplateData`) viram os tipos de props dos componentes, em `views/`.

### Templates e estáticos

| Thymeleaf | JSX |
|---|---|
| `base.html` | `views/layout.tsx` |
| `dashboard.html` (295) | `views/pages/dashboard.tsx` |
| `asset-detail.html` (393) | `views/pages/asset-detail.tsx` |
| `transactions.html` (338) | `views/pages/transactions.tsx` |
| `dividends.html` (284) | `views/pages/dividends.tsx` |
| `assets.html` (233) | `views/pages/assets.tsx` |
| `risk-metrics.html` / `evolution.html` / `login.html` | `views/pages/*.tsx` |
| `fragments/badge.html` | `views/components/badge.tsx` |
| `fragments/csv-*.html` (3) | `views/partials/*.tsx` |

Tabela de conversão:

| Thymeleaf | JSX |
|---|---|
| `th:text="${x}"` | `{x}` |
| `th:each="a : ${assets}"` | `{assets.map(a => ...)}` |
| `th:if="${cond}"` | `{cond && ...}` |
| `th:classappend="${c} ? 'active'"` | `class={\`nav-link ${c ? 'active' : ''}\`}` |
| `th:fragment="f(p)"` / `th:replace` | função componente + chamada |
| `#strings.startsWith(uri,'/x')` | `path.startsWith('/x')` |
| `#numbers.formatDecimal(...)` | `money()` de `shared/format.ts` |

Os 6 arquivos de `static/js/` viram `src/client/*.ts`, compilados por esbuild para `public/js/`. `format.js` (13 linhas, formatação de moeda) tem lógica duplicada com o servidor — unificar em `shared/format.ts`, importado pelos dois lados.

---

## 8. Estratégia de testes

Os 300 testes são o principal ativo desta migração: são eles que provam que os números não mudaram. Nenhum pode ser descartado sem justificativa escrita.

### Classificação

| Tipo | Onde | Como |
|---|---|---|
| **Puro** (cálculo, XIRR, regressão, CSV, retenção, ticker) | co-locado, `domain/*.test.ts` | Vitest, sem banco, sem mock. Milissegundos. |
| **Service com banco** | `modules/*/*.service.test.ts` | SQLite temporário por worker |
| **Integrações HTTP** | `integrations/*/*.test.ts` | MSW com os fixtures atuais |
| **Rotas** | `tests/integration/*.test.ts` | `app.inject()` |

### De-para das ferramentas

| Kotest / Spring | Vitest / Fastify |
|---|---|
| `FunSpec({ test("x") { } })` | `describe/it` |
| `shouldBe` | `expect(x).toBe(y)` |
| `shouldBe (10.0 plusOrMinus 0.001)` | `expect(x).toBeCloseTo(10.0, 3)` |
| `shouldContain` (string) | `expect(s).toContain(...)` |
| `beforeEach { transaction { …delete() } }` | `beforeEach(resetDb)` |
| `@SpringBootTest @AutoConfigureMockMvc` | `buildApp(testContainer)` |
| `mockMvc.perform(get("/x"))` | `app.inject({ method:'GET', url:'/x' })` |
| `MockRestServiceServer` | MSW (`setupServer`) |
| `@MockkBean` / `every { … } returns` | fake passado ao container, ou `vi.fn()` |
| `TestDataBuilders.kt` | `tests/factories.ts` |

`app.inject()` não abre porta de rede e devolve `statusCode`/`payload` — o porte dos testes de controller é quase linha a linha.

### Banco de teste

```ts
// tests/setup.ts
const dbPath = `/tmp/stocks-test-${process.env.VITEST_WORKER_ID}.db`
// 1x por worker: cria o arquivo a partir de um template já migrado (cópia, não migrate)
// entre testes: DELETE das 8 tabelas na ordem das FKs
```

Cópia de arquivo em vez de `prisma migrate deploy` por worker economiza segundos por execução. O reset entre testes é `DELETE FROM` sequencial — mais rápido que recriar o arquivo e equivalente ao `beforeEach` atual.

**Sobre mock do Prisma:** não usar. Bibliotecas tipo `prismock` divergem do comportamento real (constraints, cascade, defaults) justamente onde os bugs aparecem. SQLite local é rápido o bastante para os testes serem reais.

### Critério de aceitação por fase

Cada fase só fecha quando os testes Kotlin equivalentes estiverem portados e verdes. A contagem de testes é rastreada num checklist — se a fase 2 tinha 120 testes em Kotlin e fechou com 110 em TS, os 10 faltantes precisam ser justificados.

---

## 9. Fases

A ordem é ditada por duas coisas: dependências reais e concentração de risco. O domínio puro vem antes de tudo porque é onde mora a corretude financeira, não depende de infra nenhuma e concentra a maior parte dos testes — se algo vai dar errado nos números, dá errado ali, e é melhor descobrir no dia 2 que na semana 4.

| # | Fase | Entrega | Tamanho |
|---|---|---|---|
| **0** | **Spike** | Validar as 5 decisões do §3 num app de brinquedo: data como string, `VACUUM INTO` via `$executeRawUnsafe`, WAL + FK, JSX renderizado pelo Fastify, `app.inject()`. Confirmar também o timeout de `$transaction` no SQLite e escolher entre os geradores `prisma-client-js` e `prisma-client`. | ½ dia |
| **1** | **Fundação** | `package.json`, `tsconfig`, Biome, Vitest, `.mise.toml`; `schema.prisma` + migration `init`; `config/env.ts`; `app.ts` que sobe e responde `/health`; CI. | 1 dia |
| **2** | **Domínio puro** | `calculation`, `xirr`, `regression`, `evolution`, `ticker-classification`, `backup-retention`, `csv/*`, `constants`, `iso-date`. **Com todos os testes correspondentes portados.** Sem banco, sem rede. | 3 dias |
| **3** | **Integrações** | Clientes Yahoo, BCB e Tesouro + schemas Zod; MSW montado sobre os 11 fixtures atuais; testes portados. | 1,5 dia |
| **4** | **Services com banco** | Os 8 services de módulo, `container.ts`, setup de banco de teste; N+1 corrigido; testes portados. | 4 dias |
| **5** | **Views + rotas** | Layout, componentes, 8 páginas, 3 partials HTMX; as 7 rotas; `errors.ts`; testes de rota via `inject()`. Módulo a módulo, cada um fechando com seus testes. | 5 dias |
| **6** | **Infra** | Auth (`node:crypto` + hook), scheduler (croner), backup (`VACUUM INTO` + zip + rotação), estáticos, `src/client/` + esbuild. | 2 dias |
| **7** | **Fechamento** | `prisma/seed.ts` para dev local; passada manual pelas telas; remover Gradle, `src/main/kotlin`, `src/test/kotlin`, wrapper, `.editorconfig` do ktlint; reescrever `README.md`, `CLAUDE.md`, `.mise.toml`, hooks do `.claude/settings.json`; atualizar as 3 skills. | 1,5 dia |

**Total: ~18 dias de trabalho focado.** Estimativa de ordem de grandeza — a fase 5 é a mais incerta, porque o porte de JSX é o único trecho sem tradução mecânica.

Fases 2, 3 e 4 podem avançar em paralelo com a 5 se houver mais de uma pessoa; 0 e 1 são bloqueantes para todas.

### Estratégia de corte

**Big-bang numa branch**, não strangler. Para 5,5k linhas num app single-user, colocar um proxy na frente para rotear rotas entre dois processos custaria mais que o porte inteiro. A branch mantém `master` funcional até o merge, e como não há banco em produção não existe cutover de dados: quando a suíte de testes fecha e a passada manual pelas telas confirma, é só trocar.

### O que fazer com a suíte de testes durante o porte

Sem banco existente, **os testes são a única rede de segurança**. Isso muda uma coisa na prática: nenhuma fase fecha "para voltar nos testes depois". O porte de cada arquivo Kotlin e o porte dos seus testes são a mesma tarefa, no mesmo commit. Uma fase entregue sem os testes correspondentes não está entregue.

---

## 10. Riscos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| **Perder cobertura ao portar testes** | Média | **O maior risco do projeto** — sem banco de referência, os 300 testes são a única prova de corretude. Contagem por fase rastreada; faltante exige justificativa escrita |
| Divergência silenciosa nos cálculos | Média | Domínio puro portado primeiro, junto com seus testes; `toBeCloseTo` com a mesma tolerância do `plusOrMinus` atual |
| Bug de timezone em datas | **Alta** se usar `DateTime` | Regra §3.1: data é `string` ISO, tipo branded, nunca `Date` |
| `async` vazando para o domínio puro | Média | `dependency-cruiser` no CI proíbe `domain/` importar Prisma |
| Transação segurando lock com chamada de rede dentro | Média | Regra §3.3, revisada nos 3 services que fazem rede + escrita |
| Porte de JSX mais lento que o previsto | Média | Fase 5 é a maior; se estourar, dá para entregar página a página |
| `VACUUM INTO` não funcionar via Prisma | Baixa | Validado na fase 0; plano B é abrir uma conexão `better-sqlite3` direta só para o backup |
| Churn de API do Prisma | Baixa | Versão pinada; `prisma generate` no CI |

---

## 11. Checklist de conclusão

- [ ] 300 testes portados e verdes (ou faltantes justificados por escrito)
- [ ] `prisma migrate deploy` cria o banco do zero e a aplicação sobe vazia sem erro
- [ ] Fluxo completo manual: cadastrar ativo → lançar transação → ver dashboard → lançar provento → recalcular evolução → risk metrics
- [ ] Importação de CSV funcionando nas duas etapas (revisão de ativos + preview de transações)
- [ ] Backup automático rodando no boot e às 00:05, com rotação 7 diários / 3 mensais
- [ ] Login persistindo sessão entre restarts (`auth.key`)
- [ ] Scheduler disparando 18:30 (cotações) e 00:05 (backup) em `America/Sao_Paulo`
- [ ] Todas as rotas do README respondendo, HTML e JSON
- [ ] HTMX funcionando: preview de CSV, `ticker-info`, swaps OOB
- [ ] Tema claro/escuro e gráficos Chart.js intactos
- [ ] `biome check` e `tsc --noEmit` limpos
- [ ] Gradle, JVM e Kotlin removidos do repositório
- [ ] `README.md`, `CLAUDE.md` e `.mise.toml` reescritos
- [ ] Hooks `Stop` do `.claude/settings.json` migrados — hoje disparam `./gradlew ktlintFormat` e `./gradlew test` quando um `.kt`/`.kts` muda; passam a `biome check --write` e `vitest run` em `.ts`/`.tsx`
- [ ] Skills atualizadas: `h2-database` → `sqlite-database`; `csv-import` e `dividends` apontando para os novos caminhos
