from datetime import date
from unittest.mock import patch

import pytest

from app.models import Asset, Transaction


# ---------------------------------------------------------------------------
# Assets — HTML routes
# ---------------------------------------------------------------------------


def test_list_assets_page_ok(client):
    response = client.get("/assets/")
    assert response.status_code == 200


def test_create_asset_form_success(client, db_session):
    response = client.post(
        "/assets/new",
        data={"ticker": "PETR4", "name": "Petrobras", "type": "STOCK", "currency": "BRL"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/assets/"

    asset = db_session.query(Asset).filter(Asset.ticker == "PETR4").first()
    assert asset is not None
    assert asset.ticker == "PETR4"


def test_create_asset_form_duplicate(client, db_session):
    # First creation
    client.post(
        "/assets/new",
        data={"ticker": "PETR4", "name": "Petrobras", "type": "STOCK", "currency": "BRL"},
        follow_redirects=False,
    )
    # Duplicate attempt — should stay on page with an error message
    response = client.post(
        "/assets/new",
        data={"ticker": "PETR4", "name": "Petrobras", "type": "STOCK", "currency": "BRL"},
        follow_redirects=False,
    )
    assert response.status_code == 200
    assert "já cadastrado" in response.text


def test_edit_asset_form(client, db_session):
    asset = Asset(ticker="PETR4", name="Petrobras", type="STOCK", currency="BRL")
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)

    response = client.post(
        f"/assets/{asset.id}/edit",
        data={"name": "Petrobras Novo", "type": "REIT", "currency": "USD", "yf_ticker": ""},
        follow_redirects=False,
    )
    assert response.status_code == 303

    updated = db_session.query(Asset).filter(Asset.id == asset.id).first()
    assert updated.name == "Petrobras Novo"
    assert updated.type == "REIT"
    assert updated.currency == "USD"


def test_delete_asset_form(client, db_session):
    asset = Asset(ticker="PETR4", name="Petrobras", type="STOCK", currency="BRL")
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    asset_id = asset.id

    response = client.post(f"/assets/{asset_id}/delete", follow_redirects=False)
    assert response.status_code == 303

    deleted = db_session.query(Asset).filter(Asset.id == asset_id).first()
    assert deleted is None


# ---------------------------------------------------------------------------
# Assets — JSON API
# ---------------------------------------------------------------------------


def test_list_assets_api_empty(client):
    response = client.get("/assets/api")
    assert response.status_code == 200
    assert response.json() == []


def test_create_asset_api_success(client):
    response = client.post(
        "/assets/api",
        json={"ticker": "PETR4", "name": "Petrobras", "type": "STOCK", "currency": "BRL"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["ticker"] == "PETR4"
    assert data["currency"] == "BRL"


def test_create_asset_api_duplicate(client):
    client.post(
        "/assets/api",
        json={"ticker": "PETR4", "name": "Petrobras", "type": "STOCK", "currency": "BRL"},
    )
    response = client.post(
        "/assets/api",
        json={"ticker": "PETR4", "name": "Petrobras", "type": "STOCK", "currency": "BRL"},
    )
    assert response.status_code == 409


def test_get_asset_api_not_found(client):
    response = client.get("/assets/api/9999")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Transactions — JSON API
# ---------------------------------------------------------------------------


def test_create_transaction_api_invalid_asset(client):
    response = client.post(
        "/transactions/api",
        json={
            "asset_id": 9999,
            "type": "BUY",
            "quantity": 10.0,
            "price": 10.0,
            "date": "2024-01-01",
        },
    )
    assert response.status_code == 404


def test_create_transaction_api_success(client, db_session):
    asset = Asset(ticker="PETR4", name="Petrobras", type="STOCK", currency="BRL")
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)

    response = client.post(
        "/transactions/api",
        json={
            "asset_id": asset.id,
            "type": "BUY",
            "quantity": 10.0,
            "price": 25.0,
            "date": "2024-01-01",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["type"] == "BUY"
    assert data["quantity"] == 10.0


def test_list_transactions_api_filter_by_asset(client, db_session):
    asset1 = Asset(ticker="PETR4", name="Petrobras", type="STOCK", currency="BRL")
    asset2 = Asset(ticker="VALE3", name="Vale", type="STOCK", currency="BRL")
    db_session.add_all([asset1, asset2])
    db_session.flush()

    tx1 = Transaction(
        asset_id=asset1.id, type="BUY", quantity=10, price=25.0, fees=0.0,
        date=date(2024, 1, 1),
    )
    tx2 = Transaction(
        asset_id=asset2.id, type="BUY", quantity=5, price=60.0, fees=0.0,
        date=date(2024, 1, 1),
    )
    db_session.add_all([tx1, tx2])
    db_session.commit()

    response = client.get(f"/transactions/api?asset_id={asset1.id}")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["asset_id"] == asset1.id


def test_delete_transaction_api_success(client, db_session):
    asset = Asset(ticker="PETR4", name="Petrobras", type="STOCK", currency="BRL")
    db_session.add(asset)
    db_session.flush()

    tx = Transaction(
        asset_id=asset.id, type="BUY", quantity=10, price=25.0, fees=0.0,
        date=date(2024, 1, 1),
    )
    db_session.add(tx)
    db_session.commit()
    db_session.refresh(tx)

    response = client.delete(f"/transactions/api/{tx.id}")
    assert response.status_code == 204


def test_delete_transaction_api_not_found(client):
    response = client.delete("/transactions/api/9999")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Portfolio — JSON API
# ---------------------------------------------------------------------------


def test_portfolio_api_empty(client):
    with patch("app.routers.portfolio.fetch_quote", return_value=None):
        response = client.get("/portfolio/api")
    assert response.status_code == 200
    data = response.json()
    assert data["positions"] == []
    assert data["total_invested"] == pytest.approx(0.0)


def test_portfolio_api_with_brl_transaction(client, db_session):
    asset = Asset(ticker="PETR4", name="Petrobras", type="STOCK", currency="BRL")
    db_session.add(asset)
    db_session.flush()

    tx = Transaction(
        asset_id=asset.id, type="BUY", quantity=10, price=10.0, fees=0.0,
        date=date(2024, 1, 1),
    )
    db_session.add(tx)
    db_session.commit()

    with patch("app.routers.portfolio.fetch_quote", return_value=None):
        response = client.get("/portfolio/api")

    assert response.status_code == 200
    data = response.json()
    assert len(data["positions"]) == 1
    assert data["total_invested"] == pytest.approx(100.0)


def test_portfolio_api_ticker_not_found(client):
    response = client.get("/portfolio/api/PETR4")
    assert response.status_code == 404


def test_portfolio_api_ticker_no_transactions(client, db_session):
    asset = Asset(ticker="PETR4", name="Petrobras", type="STOCK", currency="BRL")
    db_session.add(asset)
    db_session.commit()

    with patch("app.routers.portfolio.fetch_quote", return_value=None):
        response = client.get("/portfolio/api/PETR4")

    assert response.status_code == 404
