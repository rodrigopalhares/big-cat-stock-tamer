# Projeto: Gestão de Carteira de Ações Brasileiras

## Convenções de Código

- **Todo o código deve ser escrito em inglês**: nomes de variáveis, funções, classes, comentários, docstrings e mensagens de log.
- A interface do usuário (templates HTML, labels, mensagens de erro exibidas ao usuário) pode permanecer em português.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI |
| ORM / DB | SQLAlchemy + SQLite |
| Templates | Jinja2 + HTMX |
| CSS | Bootstrap 5 (CDN) |
| Cálculos | numpy-financial + pandas |
| Runner | Uvicorn |
| Testes | pytest + httpx + pytest-cov |

## Estrutura

```
C:\ws\stocks\
├── CLAUDE.md
├── pyproject.toml
├── requirements.txt
├── run.py
├── app/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── routers/
│   │   ├── assets.py
│   │   ├── transactions.py
│   │   └── portfolio.py
│   ├── services/
│   │   ├── calculations.py
│   │   └── quotes.py
│   ├── templates/
│   │   ├── base.html
│   │   ├── dashboard.html
│   │   ├── assets.html
│   │   └── transactions.html
│   └── static/css/custom.css
├── tests/
│   ├── conftest.py
│   ├── test_calculations.py
│   ├── test_schemas.py
│   ├── test_quotes.py
│   └── test_routers.py
└── data/
    └── stocks.db  (gerado automaticamente)
```

## Modelos

### Asset
- `id`, `ticker` (UNIQUE), `yf_ticker`, `name`, `type` (STOCK/REIT/ETF/BDR), `currency` (BRL/USD), `created_at`

### Transaction
- `id`, `asset_id` (FK), `type` (BUY/SELL), `quantity`, `price`, `fees`, `date`, `broker`, `notes`, `created_at`

## Como Rodar

```bash
pip install -r requirements.txt
python run.py
# Acesse: http://localhost:8000
# Docs:   http://localhost:8000/docs
```

## Testes

```bash
pytest tests/ -v
pytest tests/ --cov=app --cov-report=term-missing
```
