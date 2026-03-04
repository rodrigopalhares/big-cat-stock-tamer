# Gestão de Carteira de Ações Brasileiras

Aplicação web para acompanhamento de investimentos no mercado de renda variável brasileiro. Permite cadastrar ativos, registrar compras e vendas, e visualizar o desempenho consolidado da carteira com cotações em tempo real via Yahoo Finance.

## Funcionalidades

- Cadastro de ativos: ações (STOCK), FIIs (REIT), ETFs, BDRs e Tesouro Direto
- Registro de transações de compra e venda com corretagem
- Cálculo automático de preço médio e posição atual
- Cálculo de lucro/prejuízo realizado e não realizado
- Cálculo de TIR (Taxa Interna de Retorno) mensal e anual (XIRR)
- Cotações em tempo real integradas ao Yahoo Finance
- Suporte a ativos em USD com conversão automática para BRL
- Histórico de preços com backfill automático e atualização diária
- Dashboard consolidado da carteira

## Stack

| Camada       | Tecnologia                              |
|--------------|-----------------------------------------|
| Linguagem    | Kotlin (JDK 25)                         |
| Backend      | Spring Boot 3                           |
| ORM / DB     | Exposed (DAO + DSL) + H2                |
| Migrations   | Flyway                                  |
| Frontend     | Thymeleaf + HTMX + Bootstrap 5          |
| HTTP Client  | Ktor Client (CIO)                       |
| Scheduler    | Spring @Scheduled                       |
| Testes       | Kotest + MockK + Spring Boot Test       |
| Build        | Gradle (Kotlin DSL)                     |
| Linter       | ktlint (via jlleitschuh plugin)          |

## Pré-requisitos

- JDK 25

## Ambiente de Desenvolvimento

```bash
# Opção 1: Nix (recomendado — instala tudo automaticamente)
nix develop

# Opção 2: SDKMAN!
sdk install java 25-open

# Opção 3: apt
sudo apt install openjdk-25-jdk-headless
```

## Como Executar

```bash
./gradlew bootRun
```

A aplicação estará disponível em:

- **Interface web:** http://localhost:8000
- **H2 Console:** http://localhost:8000/h2-console

O banco de dados H2 é criado automaticamente em `data/stocks.mv.db` na primeira execução.

## Estrutura do Projeto

```
stocks/
├── build.gradle.kts                          # Build Gradle (dependências, plugins)
├── settings.gradle.kts
├── flake.nix                                 # Dev environment (Nix)
├── src/
│   ├── main/
│   │   ├── kotlin/com/stocks/
│   │   │   ├── StocksApplication.kt          # Entrypoint Spring Boot
│   │   │   ├── config/
│   │   │   │   ├── HttpClientConfig.kt       # Bean HttpClient (Ktor CIO)
│   │   │   │   ├── SchedulerConfig.kt        # Jobs agendados (backfill, update)
│   │   │   │   └── WebConfig.kt              # Redirect / → /portfolio/
│   │   │   ├── model/
│   │   │   │   ├── Asset.kt                  # Tabela + Entidade Exposed
│   │   │   │   ├── Transaction.kt
│   │   │   │   └── PriceHistory.kt
│   │   │   ├── dto/
│   │   │   │   ├── Constants.kt              # ASSET_TYPES, VALID_CURRENCIES
│   │   │   │   ├── AssetDtos.kt              # Request/Response data classes
│   │   │   │   ├── TransactionDtos.kt
│   │   │   │   └── PortfolioDtos.kt
│   │   │   ├── service/
│   │   │   │   ├── CalculationService.kt     # Posição, IRR, XIRR, PnL
│   │   │   │   ├── QuoteService.kt           # Yahoo Finance + Tesouro Direto
│   │   │   │   ├── PriceHistoryService.kt    # Backfill e update diário
│   │   │   │   └── PortfolioService.kt       # Posições consolidadas
│   │   │   └── controller/
│   │   │       ├── AssetController.kt        # CRUD ativos (HTML + JSON API)
│   │   │       ├── TransactionController.kt  # CRUD transações
│   │   │       └── PortfolioController.kt    # Dashboard e posições
│   │   └── resources/
│   │       ├── application.yml               # Config (H2, Flyway, porta)
│   │       ├── templates/                    # Templates Thymeleaf
│   │       ├── static/                       # CSS, JS
│   │       └── db/migration/                 # Flyway SQL migrations
│   └── test/
│       ├── kotlin/com/stocks/
│       │   ├── service/                      # Testes unitários
│       │   └── controller/                   # Testes de integração
│       └── resources/
│           └── application-test.yml          # Config H2 in-memory para testes
└── data/
    └── stocks.mv.db                          # Banco gerado automaticamente
```

## Modelos de Dados

### Asset (Ativo)
| Campo      | Tipo   | Descrição                                     |
|------------|--------|-----------------------------------------------|
| ticker     | String | Código do ativo (PK, ex: PETR4)               |
| yfTicker   | String | Símbolo no Yahoo Finance (ex: PETR4.SA)       |
| name       | String | Nome do ativo                                 |
| type       | String | STOCK, REIT, ETF, BDR ou TESOURO_DIRETO       |
| currency   | String | BRL ou USD                                    |

### Transaction (Transação)
| Campo    | Tipo       | Descrição                         |
|----------|------------|-----------------------------------|
| id       | Int        | Identificador (PK)                |
| assetId  | String     | Ticker do ativo (FK)              |
| type     | String     | BUY ou SELL                       |
| quantity | Double     | Quantidade de cotas/ações         |
| price    | Double     | Preço unitário                    |
| fees     | Double     | Custos de corretagem              |
| date     | LocalDate  | Data da operação                  |
| broker   | String     | Corretora                         |
| notes    | String     | Observações                       |

### PriceHistory (Histórico de Preços)
| Campo    | Tipo       | Descrição                         |
|----------|------------|-----------------------------------|
| id       | Int        | Identificador (PK)                |
| assetId  | String     | Ticker do ativo (FK, CASCADE)     |
| date     | LocalDate  | Data                              |
| close    | Double     | Preço de fechamento               |

## Rotas da API

| Método | Rota                        | Descrição                       |
|--------|-----------------------------|---------------------------------|
| GET    | `/portfolio/`               | Dashboard (HTML)                |
| GET    | `/portfolio/api`            | Posições da carteira (JSON)     |
| GET    | `/portfolio/api/{ticker}`   | Posição de um ativo (JSON)      |
| GET    | `/assets/`                  | Lista de ativos (HTML)          |
| GET    | `/assets/api`               | Lista de ativos (JSON)          |
| POST   | `/assets/api`               | Criar ativo (JSON)              |
| GET    | `/assets/api/{ticker}`      | Detalhes do ativo (JSON)        |
| GET    | `/transactions/`            | Lista de transações (HTML)      |
| GET    | `/transactions/api`         | Lista de transações (JSON)      |
| POST   | `/transactions/api`         | Criar transação (JSON)          |
| DELETE | `/transactions/api/{id}`    | Excluir transação (JSON)        |

## Testes

```bash
# Rodar todos os testes
./gradlew test

# Verbose
./gradlew test --info
```

## Linting

```bash
# Verificar estilo (falha se houver violações)
./gradlew ktlintCheck

# Auto-formatar todos os arquivos Kotlin
./gradlew ktlintFormat
```

O `ktlintCheck` roda automaticamente como parte de `./gradlew build`. As regras de estilo estão configuradas no `.editorconfig`.
