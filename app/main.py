from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.database import engine
from app import models
from app.routers import assets, transactions, portfolio

# Create database tables on startup
models.Base.metadata.create_all(bind=engine)

# Migrate existing databases: add columns introduced after initial schema
with engine.connect() as _conn:
    for _col, _ddl in [
        ("yf_ticker", "ALTER TABLE assets ADD COLUMN yf_ticker VARCHAR"),
    ]:
        try:
            _conn.execute(text(_ddl))
            _conn.commit()
        except Exception:
            pass  # column already exists

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
