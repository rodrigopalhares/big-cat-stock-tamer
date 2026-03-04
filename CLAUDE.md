# Projeto: Gestão de Carteira de Ações Brasileiras

## Convenções de Código

- **Todo o código deve ser escrito em inglês**: nomes de variáveis, funções, classes, comentários, docstrings e mensagens de log.
- A interface do usuário (templates HTML, labels, mensagens de erro exibidas ao usuário) pode permanecer em português.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Linguagem | Kotlin (JDK 25) |
| Backend | Spring Boot 3 |
| ORM / DB | Exposed (DAO + DSL) + H2 |
| Migrations | Flyway |
| Templates | Thymeleaf + HTMX |
| CSS | Bootstrap 5 (CDN) |
| HTTP Client | Ktor Client (CIO) |
| JSON | kotlinx.serialization + Jackson |
| Scheduler | Spring @Scheduled |
| Testes | Kotest + MockK + Spring Boot Test |
| Build | Gradle (Kotlin DSL) |
| Linter | ktlint (via jlleitschuh plugin) |

## Estrutura

```
stocks/
├── CLAUDE.md
├── build.gradle.kts
├── settings.gradle.kts
├── flake.nix
├── src/
│   ├── main/
│   │   ├── kotlin/com/stocks/
│   │   │   ├── StocksApplication.kt
│   │   │   ├── config/
│   │   │   │   ├── HttpClientConfig.kt
│   │   │   │   ├── SchedulerConfig.kt
│   │   │   │   └── WebConfig.kt
│   │   │   ├── model/
│   │   │   │   ├── Asset.kt
│   │   │   │   ├── Transaction.kt
│   │   │   │   └── PriceHistory.kt
│   │   │   ├── dto/
│   │   │   │   ├── Constants.kt
│   │   │   │   ├── AssetDtos.kt
│   │   │   │   ├── TransactionDtos.kt
│   │   │   │   └── PortfolioDtos.kt
│   │   │   ├── service/
│   │   │   │   ├── CalculationService.kt
│   │   │   │   ├── QuoteService.kt
│   │   │   │   ├── PriceHistoryService.kt
│   │   │   │   └── PortfolioService.kt
│   │   │   └── controller/
│   │   │       ├── AssetController.kt
│   │   │       ├── TransactionController.kt
│   │   │       └── PortfolioController.kt
│   │   └── resources/
│   │       ├── application.yml
│   │       ├── templates/
│   │       │   ├── base.html
│   │       │   ├── dashboard.html
│   │       │   ├── assets.html
│   │       │   ├── transactions.html
│   │       │   └── fragments/badge.html
│   │       ├── static/
│   │       │   ├── css/custom.css
│   │       │   └── js/transactions.js
│   │       └── db/migration/
│   │           ├── V1__create_assets.sql
│   │           ├── V2__create_transactions.sql
│   │           └── V3__create_price_history.sql
│   └── test/
│       ├── kotlin/com/stocks/
│       │   ├── TestSchedulerConfig.kt
│       │   ├── service/
│       │   │   ├── CalculationServiceTest.kt
│       │   │   └── QuoteServiceTest.kt
│       │   └── controller/
│       │       ├── AssetControllerTest.kt
│       │       ├── TransactionControllerTest.kt
│       │       └── PortfolioControllerTest.kt
│       └── resources/
│           └── application-test.yml
└── data/
    └── stocks.mv.db  (gerado automaticamente pelo H2)
```

## Modelos (Exposed)

### Assets (Table) / AssetEntity (DAO)
- `ticker` (PK, String), `yfTicker`, `name`, `type` (STOCK/REIT/ETF/BDR/TESOURO_DIRETO), `currency` (BRL/USD), `createdAt`

### Transactions (Table) / TransactionEntity (DAO)
- `id` (PK, Int), `assetId` (FK → Assets), `type` (BUY/SELL), `quantity`, `price`, `fees`, `date`, `broker`, `notes`, `createdAt`

### PriceHistories (Table) / PriceHistoryEntity (DAO)
- `id` (PK, Int), `assetId` (FK → Assets, CASCADE), `date`, `close`, `createdAt`
- Unique constraint on `(assetId, date)`
- Upsert via manual SELECT + INSERT/UPDATE

## Serviços

### QuoteService
- `fetchQuotesBatch(yfTickers)` / `fetchTdQuotesBatch(yfTickers)` — preços atuais (live) via Yahoo Finance v8 API
- `fetchHistoricalQuotesBatch(yfTickerMap, startDate)` — histórico via Yahoo Finance v8 API
- `fetchTdHistoricalQuotesBatch(yfTickers)` — histórico Tesouro Direto (CSV completo)
- `fetchExchangeRate(from, to)` — câmbio com cache de 5 minutos
- `fetchAssetInfo(ticker)` — informações do ativo via Yahoo Finance
- Tesouro Direto: `yfTicker` no formato `"Tipo Titulo;dd/mm/yyyy"`

### PriceHistoryService
- `getLatestPrice(ticker)` — preço mais recente no banco
- `getLastStoredDate(ticker)` — data mais recente no banco
- `upsertPrices(records)` — insere ou atualiza registros
- `runBackfill()` — backfill de todos os ativos em batch
- `runDailyUpdate()` — atualiza preço do dia para todos os ativos

### PortfolioService
- `buildPositions(assets, fetchQuotes)` — constrói posições; usa preço do banco com fallback para API live
- `aggregatePositions(positions)` — agrega posições em PortfolioSummary

### CalculationService
- `calculatePosition(transactions)` — posição, preço médio, P&L realizado, cash flows
- `calculateIrr(cashFlows, currentValue)` — IRR via Newton-Raphson
- `calculateXirr(cashFlows, currentValue)` — XIRR via bisection
- `calculateUnrealizedPnl(quantity, avgPrice, currentPrice)` — P&L não realizado

## Scheduler (Spring @Scheduled)
- Configurado em `config/SchedulerConfig.kt` com timezone `America/Sao_Paulo`
- **Startup**: executa `runBackfill()` via `@EventListener(ApplicationReadyEvent)`
- **Diário às 18:30**: executa `runDailyUpdate()` via `@Scheduled(cron = "0 30 18 * * *")`
- Desabilitado em testes via `application-test.yml`

## Ambiente de Desenvolvimento

```bash
# Via Nix (flake.nix inclui JDK 25, Gradle, Kotlin):
nix develop

# Via SDKMAN!:
sdk install java 25-open
```

## Como Rodar

```bash
./gradlew bootRun
# Acesse: http://localhost:8000
# H2 Console: http://localhost:8000/h2-console
```

## Testes

```bash
./gradlew test
./gradlew test --info  # verbose
```

## Linting

```bash
./gradlew ktlintCheck   # verifica estilo (falha se houver violações)
./gradlew ktlintFormat  # auto-formata todos os arquivos Kotlin
```

- Configurado via `.editorconfig` (seção `[*.{kt,kts}]`)
- `ktlintCheck` roda automaticamente como parte de `./gradlew build`
- Hooks do Claude Code (`.claude/settings.json`) rodam `ktlintFormat` e `test` após cada edição de arquivos `.kt`/`.kts`
