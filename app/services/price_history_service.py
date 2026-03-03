from datetime import date, timedelta
from typing import List, Optional
import logging

from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert

from app.models import Asset, PriceHistory
from app.services.quotes import (
    fetch_historical_quotes_batch,
    fetch_td_historical_quotes_batch,
)

logger = logging.getLogger(__name__)


def get_last_stored_date(asset_ticker: str, db: Session) -> Optional[date]:
    """Return the most recent date stored in price_history for this asset, or None."""
    row = (
        db.query(PriceHistory.date)
        .filter(PriceHistory.asset_id == asset_ticker)
        .order_by(PriceHistory.date.desc())
        .first()
    )
    return row[0] if row else None


def get_latest_price(asset_ticker: str, db: Session) -> Optional[float]:
    """Return the most recent close price stored for this asset, or None."""
    row = (
        db.query(PriceHistory.close)
        .filter(PriceHistory.asset_id == asset_ticker)
        .order_by(PriceHistory.date.desc())
        .first()
    )
    return row[0] if row else None


def upsert_prices(records: List[dict], db: Session) -> None:
    """
    Insert-or-update price_history rows.

    Each record must have keys: asset_id, date, close.
    Uses SQLite INSERT OR REPLACE via on_conflict_do_update.
    """
    if not records:
        return

    stmt = insert(PriceHistory).values(records)
    stmt = stmt.on_conflict_do_update(
        index_elements=["asset_id", "date"],
        set_={"close": stmt.excluded.close},
    )
    db.execute(stmt)
    db.commit()


def _first_transaction_date(asset: Asset) -> Optional[date]:
    """Return the earliest transaction date for this asset."""
    if not asset.transactions:
        return None
    return min(t.date for t in asset.transactions)


def backfill_asset(asset: Asset, db: Session) -> None:
    """
    Fetch and store close prices for a single asset from its first transaction
    date (or the day after the last stored date) up to today.
    """
    first_tx = _first_transaction_date(asset)
    if first_tx is None:
        return

    last_stored = get_last_stored_date(asset.ticker, db)
    start_date = (last_stored + timedelta(days=1)) if last_stored else first_tx
    today = date.today()

    if start_date > today:
        return

    try:
        if asset.type == "TESOURO_DIRETO":
            if not asset.yf_ticker:
                return
            raw = fetch_td_historical_quotes_batch([asset.yf_ticker])
            prices = raw.get(asset.yf_ticker, [])
        else:
            yf_ticker = asset.yf_ticker or (
                f"{asset.ticker}.SA" if "." not in asset.ticker else asset.ticker
            )
            raw = fetch_historical_quotes_batch({yf_ticker: asset.ticker}, start_date)
            prices = raw.get(asset.ticker, [])

        records = [
            {"asset_id": asset.ticker, "date": d, "close": close}
            for d, close in prices
            if d >= start_date
        ]
        upsert_prices(records, db)
        logger.info(f"Backfilled {len(records)} records for {asset.ticker}")
    except Exception as e:
        logger.error(f"Error backfilling {asset.ticker}: {e}")


def run_backfill(db_factory) -> None:
    """
    Backfill all assets with transactions, batching yfinance and TD assets separately
    to minimise API calls.
    """
    db: Session = db_factory()
    try:
        assets = db.query(Asset).all()
        # Pre-load transactions to avoid lazy-load issues outside the session
        for a in assets:
            _ = a.transactions  # noqa: F841

        yf_ticker_map: dict = {}  # {yf_ticker: asset_ticker}
        td_ticker_map: dict = {}  # {yf_ticker: asset}
        start_dates: dict = {}   # {asset_ticker: start_date}
        today = date.today()

        for asset in assets:
            first_tx = _first_transaction_date(asset)
            if first_tx is None:
                continue

            last_stored = get_last_stored_date(asset.ticker, db)
            start = (last_stored + timedelta(days=1)) if last_stored else first_tx
            if start > today:
                continue

            start_dates[asset.ticker] = start

            if asset.type == "TESOURO_DIRETO":
                if asset.yf_ticker:
                    td_ticker_map[asset.yf_ticker] = asset
            else:
                yf_ticker = asset.yf_ticker or (
                    f"{asset.ticker}.SA" if "." not in asset.ticker else asset.ticker
                )
                yf_ticker_map[yf_ticker] = asset.ticker

        # --- yfinance batch ---
        if yf_ticker_map:
            earliest = min(start_dates[t] for t in yf_ticker_map.values() if t in start_dates)
            try:
                batch = fetch_historical_quotes_batch(yf_ticker_map, earliest)
                records = []
                for asset_ticker, prices in batch.items():
                    cutoff = start_dates.get(asset_ticker, earliest)
                    for d, close in prices:
                        if d >= cutoff:
                            records.append({"asset_id": asset_ticker, "date": d, "close": close})
                upsert_prices(records, db)
                logger.info(f"Backfilled {len(records)} yfinance records for {len(yf_ticker_map)} assets")
            except Exception as e:
                logger.error(f"Error in yfinance backfill batch: {e}")

        # --- Tesouro Direto batch ---
        if td_ticker_map:
            try:
                batch = fetch_td_historical_quotes_batch(list(td_ticker_map.keys()))
                records = []
                for yf_ticker, prices in batch.items():
                    asset = td_ticker_map[yf_ticker]
                    cutoff = start_dates.get(asset.ticker, date.min)
                    for d, close in prices:
                        if d >= cutoff:
                            records.append({"asset_id": asset.ticker, "date": d, "close": close})
                upsert_prices(records, db)
                logger.info(f"Backfilled {len(records)} TD records for {len(td_ticker_map)} assets")
            except Exception as e:
                logger.error(f"Error in TD backfill batch: {e}")

    finally:
        db.close()


def run_daily_update(db_factory) -> None:
    """
    Fetch and store today's close price for all active assets.
    Uses the same batching strategy as run_backfill but only requests today's data.
    """
    db: Session = db_factory()
    try:
        assets = db.query(Asset).all()
        for a in assets:
            _ = a.transactions  # noqa: F841

        today = date.today()

        yf_ticker_map: dict = {}
        td_ticker_map: dict = {}

        for asset in assets:
            if not asset.transactions:
                continue
            if asset.type == "TESOURO_DIRETO":
                if asset.yf_ticker:
                    td_ticker_map[asset.yf_ticker] = asset
            else:
                yf_ticker = asset.yf_ticker or (
                    f"{asset.ticker}.SA" if "." not in asset.ticker else asset.ticker
                )
                yf_ticker_map[yf_ticker] = asset.ticker

        if yf_ticker_map:
            try:
                batch = fetch_historical_quotes_batch(yf_ticker_map, today)
                records = [
                    {"asset_id": asset_ticker, "date": d, "close": close}
                    for asset_ticker, prices in batch.items()
                    for d, close in prices
                    if d == today
                ]
                upsert_prices(records, db)
                logger.info(f"Daily update: stored {len(records)} yfinance prices")
            except Exception as e:
                logger.error(f"Error in daily yfinance update: {e}")

        if td_ticker_map:
            try:
                batch = fetch_td_historical_quotes_batch(list(td_ticker_map.keys()))
                records = []
                for yf_ticker, prices in batch.items():
                    asset = td_ticker_map[yf_ticker]
                    for d, close in prices:
                        if d == today:
                            records.append({"asset_id": asset.ticker, "date": d, "close": close})
                upsert_prices(records, db)
                logger.info(f"Daily update: stored {len(records)} TD prices")
            except Exception as e:
                logger.error(f"Error in daily TD update: {e}")
    finally:
        db.close()
