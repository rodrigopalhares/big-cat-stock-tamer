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
| Scheduler | APScheduler (BackgroundScheduler) |
| Testes | pytest + httpx + pytest-cov |

## Estrutura

```
stocks/
├── CLAUDE.md
├── pyproject.toml
├── requirements.txt
├── run.py
├── app/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── constants.py
│   ├── routers/
│   │   ├── assets.py
│   │   ├── transactions.py
│   │   └── portfolio.py
│   ├── services/
│   │   ├── calculations.py
│   │   ├── quotes.py
│   │   ├── portfolio_service.py
│   │   └── price_history_service.py
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
│   ├── test_routers.py
│   └── test_price_history.py
└── data/
    └── stocks.db  (gerado automaticamente)
```

## Modelos

### Asset
- `ticker` (PK), `yf_ticker`, `name`, `type` (STOCK/REIT/ETF/BDR/TESOURO_DIRETO), `currency` (BRL/USD), `created_at`

### Transaction
- `id`, `asset_id` (FK → Asset.ticker), `type` (BUY/SELL), `quantity`, `price`, `fees`, `date`, `broker`, `notes`, `created_at`

### PriceHistory
- `id`, `asset_id` (FK → Asset.ticker, CASCADE), `date`, `close`, `created_at`
- Unique constraint on `(asset_id, date)`
- Upsert via SQLite `INSERT OR REPLACE` (`on_conflict_do_update`)

## Serviços

### quotes.py
- `fetch_quotes_batch` / `fetch_td_quotes_batch` — preços atuais (live)
- `fetch_historical_quotes_batch(yf_ticker_map, start_date)` — histórico yfinance em batch
- `fetch_td_historical_quotes_batch(yf_tickers)` — histórico Tesouro Direto (CSV completo)
- Tesouro Direto: `yf_ticker` no formato `"Tipo Titulo;dd/mm/yyyy"`

### price_history_service.py
- `get_latest_price(ticker, db)` — preço mais recente no banco
- `get_last_stored_date(ticker, db)` — data mais recente no banco
- `upsert_prices(records, db)` — insere ou atualiza registros
- `backfill_asset(asset, db)` — backfill individual
- `run_backfill(db_factory)` — backfill de todos os ativos em batch
- `run_daily_update(db_factory)` — atualiza preço do dia para todos os ativos

### portfolio_service.py
- `build_positions(assets, fetch_quotes=False, db=None)`
  - Com `db`: usa preço do banco; fallback para API live se não houver registro
  - Sem `db`: comportamento anterior (somente API live)

## Scheduler (APScheduler)
- Configurado em `app/main.py` com timezone `America/Sao_Paulo`
- **Startup**: executa `run_backfill` uma vez
- **Diário às 18:30**: executa `run_daily_update`
- Desabilitado graciosamente se `apscheduler` não estiver instalado

## Como Rodar

```bash
pip install -r requirements.txt
python run.py
# Acesse: http://localhost:8000
# Docs:   http://localhost:8000/docs
```

## Testes

```bash
venv/bin/pytest tests/ -v
venv/bin/pytest tests/ --cov=app --cov-report=term-missing
```
