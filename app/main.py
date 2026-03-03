from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.database import engine, SessionLocal
from app import models
from app.routers import assets, transactions, portfolio

# Create database tables on startup
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Stock Portfolio Manager",
    description="Track your Brazilian stock market investments",
    version="0.1.0",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(portfolio.router)
app.include_router(assets.router)
app.include_router(transactions.router)


try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.services.price_history_service import run_backfill, run_daily_update

    scheduler = BackgroundScheduler(timezone="America/Sao_Paulo")

    @app.on_event("startup")
    def startup_event():
        scheduler.add_job(
            lambda: run_backfill(SessionLocal),
            id="backfill",
            replace_existing=True,
        )
        scheduler.add_job(
            lambda: run_daily_update(SessionLocal),
            trigger="cron",
            hour=18,
            minute=30,
            id="daily_update",
            replace_existing=True,
        )
        scheduler.start()

    @app.on_event("shutdown")
    def shutdown_event():
        scheduler.shutdown(wait=False)

except ImportError:
    import logging
    logging.getLogger(__name__).warning("apscheduler not installed — background price refresh disabled")


@app.get("/")
def root():
    return RedirectResponse(url="/portfolio/")
