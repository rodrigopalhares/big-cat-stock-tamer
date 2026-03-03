from datetime import date, timedelta
from unittest.mock import patch, MagicMock

import pytest

from app.models import Asset, Transaction, PriceHistory
from app.services.price_history_service import (
    get_last_stored_date,
    get_latest_price,
    upsert_prices,
    backfill_asset,
)
from app.services.portfolio_service import build_positions


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_asset(db, ticker="PETR4", asset_type="STOCK", yf_ticker="PETR4.SA"):
    asset = Asset(ticker=ticker, yf_ticker=yf_ticker, name=ticker, type=asset_type, currency="BRL")
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


def make_transaction(db, asset, tx_date=None, price=30.0):
    if tx_date is None:
        tx_date = date(2024, 1, 10)
    tx = Transaction(
        asset_id=asset.ticker,
        type="BUY",
        quantity=10,
        price=price,
        fees=0.0,
        date=tx_date,
    )
    db.add(tx)
    db.commit()
    return tx


# ---------------------------------------------------------------------------
# upsert_prices
# ---------------------------------------------------------------------------

def test_upsert_inserts_new_records(db_session):
    asset = make_asset(db_session)
    records = [
        {"asset_id": "PETR4", "date": date(2024, 1, 10), "close": 30.0},
        {"asset_id": "PETR4", "date": date(2024, 1, 11), "close": 31.0},
    ]
    upsert_prices(records, db_session)

    rows = db_session.query(PriceHistory).filter_by(asset_id="PETR4").order_by(PriceHistory.date).all()
    assert len(rows) == 2
    assert rows[0].close == 30.0
    assert rows[1].close == 31.0


def test_upsert_updates_existing_record(db_session):
    asset = make_asset(db_session)
    records = [{"asset_id": "PETR4", "date": date(2024, 1, 10), "close": 30.0}]
    upsert_prices(records, db_session)

    updated = [{"asset_id": "PETR4", "date": date(2024, 1, 10), "close": 35.0}]
    upsert_prices(updated, db_session)

    rows = db_session.query(PriceHistory).filter_by(asset_id="PETR4").all()
    assert len(rows) == 1
    assert rows[0].close == 35.0


def test_upsert_empty_list_is_noop(db_session):
    upsert_prices([], db_session)
    assert db_session.query(PriceHistory).count() == 0


# ---------------------------------------------------------------------------
# get_last_stored_date
# ---------------------------------------------------------------------------

def test_get_last_stored_date_no_history(db_session):
    make_asset(db_session)
    result = get_last_stored_date("PETR4", db_session)
    assert result is None


def test_get_last_stored_date_returns_latest(db_session):
    asset = make_asset(db_session)
    upsert_prices([
        {"asset_id": "PETR4", "date": date(2024, 1, 10), "close": 30.0},
        {"asset_id": "PETR4", "date": date(2024, 1, 15), "close": 32.0},
        {"asset_id": "PETR4", "date": date(2024, 1, 12), "close": 31.0},
    ], db_session)

    result = get_last_stored_date("PETR4", db_session)
    assert result == date(2024, 1, 15)


# ---------------------------------------------------------------------------
# get_latest_price
# ---------------------------------------------------------------------------

def test_get_latest_price_no_history(db_session):
    make_asset(db_session)
    assert get_latest_price("PETR4", db_session) is None


def test_get_latest_price_returns_most_recent_close(db_session):
    asset = make_asset(db_session)
    upsert_prices([
        {"asset_id": "PETR4", "date": date(2024, 1, 10), "close": 30.0},
        {"asset_id": "PETR4", "date": date(2024, 1, 15), "close": 40.0},
    ], db_session)

    result = get_latest_price("PETR4", db_session)
    assert result == pytest.approx(40.0)


# ---------------------------------------------------------------------------
# backfill_asset — yfinance asset
# ---------------------------------------------------------------------------

def test_backfill_asset_yfinance(db_session):
    asset = make_asset(db_session, ticker="PETR4", asset_type="STOCK", yf_ticker="PETR4.SA")
    make_transaction(db_session, asset, tx_date=date(2024, 1, 10))
    db_session.refresh(asset)

    mock_prices = [(date(2024, 1, 10), 30.0), (date(2024, 1, 11), 31.0)]

    with patch(
        "app.services.price_history_service.fetch_historical_quotes_batch",
        return_value={"PETR4": mock_prices},
    ):
        backfill_asset(asset, db_session)

    rows = db_session.query(PriceHistory).filter_by(asset_id="PETR4").order_by(PriceHistory.date).all()
    assert len(rows) == 2
    assert rows[0].close == 30.0
    assert rows[1].close == 31.0


def test_backfill_asset_skips_dates_before_start(db_session):
    """Prices before start_date must be filtered out."""
    asset = make_asset(db_session, ticker="PETR4", asset_type="STOCK", yf_ticker="PETR4.SA")
    make_transaction(db_session, asset, tx_date=date(2024, 1, 10))
    # Pre-store a price so start_date = 2024-01-12
    upsert_prices([{"asset_id": "PETR4", "date": date(2024, 1, 11), "close": 29.0}], db_session)
    db_session.refresh(asset)

    mock_prices = [
        (date(2024, 1, 10), 28.0),  # before start → must be skipped
        (date(2024, 1, 12), 31.0),
    ]

    with patch(
        "app.services.price_history_service.fetch_historical_quotes_batch",
        return_value={"PETR4": mock_prices},
    ):
        backfill_asset(asset, db_session)

    rows = db_session.query(PriceHistory).filter_by(asset_id="PETR4").order_by(PriceHistory.date).all()
    dates = [r.date for r in rows]
    assert date(2024, 1, 10) not in dates
    assert date(2024, 1, 12) in dates


def test_backfill_asset_no_transactions_is_noop(db_session):
    asset = make_asset(db_session, ticker="PETR4")
    backfill_asset(asset, db_session)
    assert db_session.query(PriceHistory).count() == 0


# ---------------------------------------------------------------------------
# backfill_asset — Tesouro Direto asset
# ---------------------------------------------------------------------------

def test_backfill_asset_tesouro_direto(db_session):
    yf_ticker = "Tesouro SELIC 2029;01/03/2029"
    asset = make_asset(db_session, ticker="TESOURO_SELIC_2029", asset_type="TESOURO_DIRETO", yf_ticker=yf_ticker)
    make_transaction(db_session, asset, tx_date=date(2024, 1, 10))
    db_session.refresh(asset)

    mock_prices = [(date(2024, 1, 10), 14000.0), (date(2024, 1, 11), 14050.0)]

    with patch(
        "app.services.price_history_service.fetch_td_historical_quotes_batch",
        return_value={yf_ticker: mock_prices},
    ):
        backfill_asset(asset, db_session)

    rows = db_session.query(PriceHistory).filter_by(asset_id="TESOURO_SELIC_2029").order_by(PriceHistory.date).all()
    assert len(rows) == 2
    assert rows[0].close == pytest.approx(14000.0)


# ---------------------------------------------------------------------------
# build_positions — uses DB price over live fetch
# ---------------------------------------------------------------------------

def test_build_positions_uses_db_price(db_session):
    asset = make_asset(db_session, ticker="PETR4", asset_type="STOCK", yf_ticker="PETR4.SA")
    make_transaction(db_session, asset, tx_date=date(2024, 1, 10), price=30.0)
    db_session.refresh(asset)

    # Store a DB price
    upsert_prices([{"asset_id": "PETR4", "date": date(2024, 1, 15), "close": 45.0}], db_session)

    # Even if fetch_quotes_batch would return a different price, the DB value wins
    with patch("app.services.portfolio_service.fetch_quotes_batch", return_value={"PETR4.SA": 99.0}):
        positions = build_positions([asset], fetch_quotes=True, db=db_session)

    assert len(positions) == 1
    assert positions[0].current_price == pytest.approx(45.0)


def test_build_positions_falls_back_to_live_when_no_db_price(db_session):
    asset = make_asset(db_session, ticker="PETR4", asset_type="STOCK", yf_ticker="PETR4.SA")
    make_transaction(db_session, asset, tx_date=date(2024, 1, 10), price=30.0)
    db_session.refresh(asset)

    # No price stored in DB
    with patch("app.services.portfolio_service.fetch_quotes_batch", return_value={"PETR4.SA": 55.0}):
        with patch("app.services.portfolio_service.fetch_exchange_rate", return_value=1.0):
            positions = build_positions([asset], fetch_quotes=True, db=db_session)

    assert len(positions) == 1
    assert positions[0].current_price == pytest.approx(55.0)
