from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas import AssetCreate, TransactionCreate


# ---------------------------------------------------------------------------
# AssetCreate
# ---------------------------------------------------------------------------


def test_asset_ticker_normalized():
    asset = AssetCreate(ticker=" petr4 ")
    assert asset.ticker == "PETR4"


def test_asset_type_invalid():
    with pytest.raises(ValidationError):
        AssetCreate(ticker="PETR4", type="FOO")


@pytest.mark.parametrize("asset_type", ["STOCK", "REIT", "ETF", "BDR"])
def test_asset_type_valid(asset_type):
    asset = AssetCreate(ticker="PETR4", type=asset_type)
    assert asset.type == asset_type


def test_asset_currency_default():
    asset = AssetCreate(ticker="PETR4")
    assert asset.currency == "BRL"


# ---------------------------------------------------------------------------
# TransactionCreate
# ---------------------------------------------------------------------------


def test_transaction_type_normalized():
    tx = TransactionCreate(
        asset_id="PETR4", type="buy", quantity=10.0, price=10.0, date=date(2024, 1, 1)
    )
    assert tx.type == "BUY"


def test_transaction_type_invalid():
    with pytest.raises(ValidationError):
        TransactionCreate(
            asset_id="PETR4", type="HOLD", quantity=10.0, price=10.0, date=date(2024, 1, 1)
        )


def test_transaction_quantity_zero():
    with pytest.raises(ValidationError):
        TransactionCreate(
            asset_id="PETR4", type="BUY", quantity=0.0, price=10.0, date=date(2024, 1, 1)
        )


def test_transaction_quantity_negative():
    with pytest.raises(ValidationError):
        TransactionCreate(
            asset_id="PETR4", type="BUY", quantity=-5.0, price=10.0, date=date(2024, 1, 1)
        )


def test_transaction_price_zero():
    with pytest.raises(ValidationError):
        TransactionCreate(
            asset_id="PETR4", type="BUY", quantity=10.0, price=0.0, date=date(2024, 1, 1)
        )


def test_transaction_price_negative():
    with pytest.raises(ValidationError):
        TransactionCreate(
            asset_id="PETR4", type="BUY", quantity=10.0, price=-1.0, date=date(2024, 1, 1)
        )


def test_transaction_valid():
    tx = TransactionCreate(
        asset_id="PETR4",
        type="BUY",
        quantity=10.0,
        price=20.5,
        fees=1.5,
        date=date(2024, 1, 1),
        broker="XP",
    )
    assert tx.type == "BUY"
    assert tx.quantity == 10.0
    assert tx.price == 20.5
    assert tx.fees == 1.5
    assert tx.broker == "XP"
