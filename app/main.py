from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.database import engine
from app import models
from app.routers import assets, transactions, portfolio

# Create database tables on startup
models.Base.metadata.create_all(bind=engine)

# Migrate existing databases: promote ticker to PK (drop id column)
engine.dispose()  # release pool connections so SQLite allows DDL
with engine.connect() as _conn:
    try:
        rows = _conn.execute(text("PRAGMA table_info(assets)")).fetchall()
        if any(r[1] == "id" for r in rows):  # old schema detected
            _conn.execute(text("""
                CREATE TABLE assets_new (
                    ticker TEXT PRIMARY KEY,
                    yf_ticker TEXT, name TEXT, type TEXT,
                    currency TEXT DEFAULT 'BRL', created_at DATETIME
                )"""))
            _conn.execute(text(
                "INSERT INTO assets_new SELECT ticker,yf_ticker,name,type,currency,created_at FROM assets"
            ))
            _conn.execute(text("""
                CREATE TABLE transactions_new (
                    id INTEGER PRIMARY KEY,
                    asset_id TEXT NOT NULL REFERENCES assets_new(ticker),
                    type TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL,
                    fees REAL DEFAULT 0.0, date DATE NOT NULL,
                    broker TEXT, notes TEXT, created_at DATETIME
                )"""))
            _conn.execute(text("""
                INSERT INTO transactions_new
                SELECT t.id, a.ticker, t.type, t.quantity, t.price,
                       t.fees, t.date, t.broker, t.notes, t.created_at
                FROM transactions t JOIN assets a ON t.asset_id = a.id
            """))
            _conn.execute(text("DROP TABLE transactions"))
            _conn.execute(text("DROP TABLE assets"))
            _conn.execute(text("ALTER TABLE assets_new RENAME TO assets"))
            _conn.execute(text("ALTER TABLE transactions_new RENAME TO transactions"))
            _conn.commit()
    except Exception:
        pass  # schema already new or DB empty

app = FastAPI(
    title="Stock Portfolio Manager",
    description="Track your Brazilian stock market investments",
    version="0.1.0",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(portfolio.router)
app.include_router(assets.router)
app.include_router(transactions.router)


@app.get("/")
def root():
    return RedirectResponse(url="/portfolio/")
