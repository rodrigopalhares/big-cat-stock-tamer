# Gestão de Carteira de Ações Brasileiras

Aplicação web para acompanhamento de investimentos no mercado de renda variável brasileiro. Permite cadastrar ativos, registrar compras e vendas, e visualizar o desempenho consolidado da carteira com cotações em tempo real via Yahoo Finance.

## Funcionalidades

- Cadastro de ativos: ações (STOCK), FIIs (REIT), ETFs e BDRs
- Registro de transações de compra e venda com corretagem
- Cálculo automático de preço médio e posição atual
- Cálculo de lucro/prejuízo realizado e não realizado
- Cálculo de TIR (Taxa Interna de Retorno) da carteira
- Cotações em tempo real integradas ao Yahoo Finance
- Dashboard consolidado da carteira

## Stack

| Camada       | Tecnologia                        |
|--------------|-----------------------------------|
| Backend      | FastAPI + Uvicorn                 |
| Banco        | SQLAlchemy + SQLite               |
| Frontend     | Jinja2 + HTMX + Bootstrap 5       |
| Cálculos     | numpy-financial + pandas          |
| Cotações     | yfinance                          |
| Testes       | pytest + httpx + pytest-cov       |

## Pré-requisitos

- Python 3.11 ou superior

## Instalação

```bash
# Clone o repositório
git clone <url-do-repo>
cd stocks

# Instale as dependências
pip install -r requirements.txt
```

## Como Executar

```bash
python run.py
```

A aplicação estará disponível em:

- **Interface web:** http://localhost:8000
- **Documentação da API (Swagger):** http://localhost:8000/docs

O banco de dados SQLite é criado automaticamente em `data/stocks.db` na primeira execução.

## Estrutura do Projeto

```
stocks/
├── run.py                        # Entrypoint da aplicação
├── requirements.txt
├── pyproject.toml
├── app/
│   ├── main.py                   # Instância FastAPI e registro de routers
│   ├── database.py               # Engine SQLite e sessão
│   ├── models.py                 # Modelos ORM (Asset, Transaction)
│   ├── schemas.py                # Schemas Pydantic
│   ├── routers/
│   │   ├── assets.py             # CRUD de ativos
│   │   ├── transactions.py       # CRUD de transações
│   │   └── portfolio.py          # Dashboard e posições
│   ├── services/
│   │   ├── calculations.py       # Cálculo de posição, TIR, PnL
│   │   └── quotes.py             # Integração com Yahoo Finance
│   └── templates/                # Templates Jinja2
├── tests/
│   ├── conftest.py
│   ├── test_calculations.py
│   ├── test_schemas.py
│   ├── test_quotes.py
│   └── test_routers.py
└── data/
    └── stocks.db                 # Banco gerado automaticamente
```

## Modelos de Dados

### Asset (Ativo)
| Campo      | Tipo   | Descrição                              |
|------------|--------|----------------------------------------|
| ticker     | string | Código do ativo (PK, ex: PETR4)        |
| yf_ticker  | string | Símbolo no Yahoo Finance (ex: PETR4.SA)|
| name       | string | Nome do ativo                          |
| type       | string | STOCK, REIT, ETF ou BDR                |
| currency   | string | BRL ou USD                             |

### Transaction (Transação)
| Campo    | Tipo   | Descrição                         |
|----------|--------|-----------------------------------|
| id       | int    | Identificador (PK)                |
| asset_id | string | Ticker do ativo (FK)              |
| type     | string | BUY ou SELL                       |
| quantity | float  | Quantidade de cotas/ações         |
| price    | float  | Preço unitário                    |
| fees     | float  | Custos de corretagem              |
| date     | date   | Data da operação                  |
| broker   | string | Corretora                         |
| notes    | text   | Observações                       |

## Rotas da API

| Método | Rota                  | Descrição                       |
|--------|-----------------------|---------------------------------|
| GET    | `/portfolio/`         | Dashboard (HTML)                |
| GET    | `/portfolio/api`      | Posições da carteira (JSON)     |
| GET    | `/assets/`            | Lista de ativos (HTML)          |
| GET    | `/assets/api`         | Lista de ativos (JSON)          |
| GET    | `/transactions/`      | Lista de transações (HTML)      |
| GET    | `/transactions/api`   | Lista de transações (JSON)      |

## Testes

```bash
# Rodar todos os testes
pytest tests/ -v

# Rodar com relatório de cobertura
pytest tests/ --cov=app --cov-report=term-missing
```
