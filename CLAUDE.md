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

## Estrutura

```
C:\ws\stocks\
├── CLAUDE.md
├── pyproject.toml
├── requirements.txt
├── run.py
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── routers/
│   │   ├── ativos.py
│   │   ├── transacoes.py
│   │   └── carteira.py
│   ├── services/
│   │   ├── calculos.py
│   │   └── cotacoes.py
│   ├── templates/
│   │   ├── base.html
│   │   ├── dashboard.html
│   │   ├── ativos.html
│   │   └── transacoes.html
│   └── static/css/custom.css
└── data/
    └── stocks.db  (gerado automaticamente)
```

## Modelos

### Ativo
- id, ticker (UNIQUE), nome, tipo (ACAO/FII/ETF/BDR), created_at

### Transacao
- id, ativo_id (FK), tipo (COMPRA/VENDA), quantidade, preco, taxas, data, corretora, notas, created_at

## Lógica de Cálculos

- **Preço médio**: custo_total_acumulado / quantidade_total (compras somam, vendas reduzem quantidade mas não alteram PM)
- **Lucro realizado por venda**: (preco_venda - preco_medio) * quantidade - taxas
- **TIR**: `npf.irr(fluxos)` — compras negativas, vendas positivas, posição atual como último fluxo

## Como Rodar

```bash
pip install -r requirements.txt
python run.py
# Acesse: http://localhost:8000
# Docs:   http://localhost:8000/docs
```
