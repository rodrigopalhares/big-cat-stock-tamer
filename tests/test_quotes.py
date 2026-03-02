from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

import app.services.quotes as quotes_module
from app.services.quotes import fetch_asset_info, fetch_exchange_rate, fetch_quote


@pytest.fixture(autouse=True)
def clear_rate_cache():
    """Ensure the module-level rate cache is empty before and after each test."""
    quotes_module._rate_cache.clear()
    yield
    quotes_module._rate_cache.clear()


# ---------------------------------------------------------------------------
# fetch_exchange_rate
# ---------------------------------------------------------------------------


def test_exchange_rate_same_currency():
    result = fetch_exchange_rate("BRL", "BRL")
    assert result == 1.0


def test_exchange_rate_cache_valid():
    """A fresh cache entry is returned without calling yfinance."""
    now = datetime.now(timezone.utc).timestamp()
    quotes_module._rate_cache["USD_BRL"] = (5.5, now)

    with patch("app.services.quotes.yf") as mock_yf:
        result = fetch_exchange_rate("USD", "BRL")
        mock_yf.Ticker.assert_not_called()

    assert result == pytest.approx(5.5)


def test_exchange_rate_cache_expired():
    """An expired cache entry causes yfinance to be called and result re-cached."""
    old_time = datetime.now(timezone.utc).timestamp() - 400  # > 300 s ago
    quotes_module._rate_cache["USD_BRL"] = (4.9, old_time)

    mock_ticker = MagicMock()
    mock_ticker.fast_info.last_price = 5.5

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_exchange_rate("USD", "BRL")

    assert result == pytest.approx(5.5)


def test_exchange_rate_yfinance_exception():
    """When yfinance raises, the hardcoded fallback 6.0 is returned."""
    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.side_effect = Exception("network error")
        result = fetch_exchange_rate("USD", "BRL")

    assert result == pytest.approx(6.0)


# ---------------------------------------------------------------------------
# fetch_asset_info
# ---------------------------------------------------------------------------


def test_fetch_asset_info_stock():
    mock_ticker = MagicMock()
    mock_ticker.info = {
        "longName": "Petrobras SA",
        "quoteType": "EQUITY",
        "sector": "Energy",
        "currency": "USD",
    }

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_asset_info("PETR4")

    assert result["name"] == "Petrobras SA"
    assert result["type"] == "STOCK"
    assert result["currency"] == "USD"


def test_fetch_asset_info_etf():
    mock_ticker = MagicMock()
    mock_ticker.info = {
        "longName": "iShares ETF",
        "quoteType": "ETF",
        "sector": "",
        "currency": "BRL",
    }

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_asset_info("BOVA11")

    assert result["type"] == "ETF"


def test_fetch_asset_info_reit():
    mock_ticker = MagicMock()
    mock_ticker.info = {
        "longName": "FII XPML",
        "quoteType": "EQUITY",
        "sector": "Real Estate Investment Trusts",
        "currency": "BRL",
    }

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_asset_info("XPML11")

    assert result["type"] == "REIT"


def test_fetch_asset_info_no_suffix_tries_sa_first():
    """Without a dot in the ticker, PETR4.SA is attempted before bare PETR4."""
    mock_ticker = MagicMock()
    mock_ticker.info = {
        "longName": "Petrobras SA",
        "quoteType": "EQUITY",
        "sector": "",
        "currency": "BRL",
    }

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_asset_info("PETR4")

    # First candidate tried is <ticker>.SA
    first_call_arg = mock_yf.Ticker.call_args_list[0][0][0]
    assert first_call_arg == "PETR4.SA"
    assert result["yf_ticker"] == "PETR4.SA"


def test_fetch_asset_info_fallback_no_name():
    """When no candidate returns a name, falls back to ticker with STOCK type."""
    mock_ticker = MagicMock()
    mock_ticker.info = {"longName": None, "shortName": None}

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_asset_info("UNKNWN")

    assert result["name"] == "UNKNWN"
    assert result["type"] == "STOCK"


def test_fetch_asset_info_unknown_currency_normalizes_to_brl():
    """Currency not in (BRL, USD) is normalized to BRL."""
    mock_ticker = MagicMock()
    mock_ticker.info = {
        "longName": "Some European Stock",
        "quoteType": "EQUITY",
        "sector": "",
        "currency": "EUR",
    }

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_asset_info("SOME")

    assert result["currency"] == "BRL"


def test_fetch_asset_info_yfinance_unavailable():
    """When YFINANCE_AVAILABLE=False, returns fallback immediately."""
    with patch("app.services.quotes.YFINANCE_AVAILABLE", False):
        result = fetch_asset_info("PETR4")

    assert result["name"] == "PETR4"
    assert result["type"] == "STOCK"
    assert "yf_ticker" in result


# ---------------------------------------------------------------------------
# fetch_quote
# ---------------------------------------------------------------------------


def test_fetch_quote_yfinance_unavailable():
    with patch("app.services.quotes.YFINANCE_AVAILABLE", False):
        assert fetch_quote("PETR4.SA") is None


def test_fetch_quote_returns_price():
    mock_ticker = MagicMock()
    mock_ticker.fast_info.last_price = 42.5

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_quote("PETR4.SA")

    assert result == pytest.approx(42.5)


def test_fetch_quote_price_zero_returns_none():
    mock_ticker = MagicMock()
    mock_ticker.fast_info.last_price = 0

    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.return_value = mock_ticker
        result = fetch_quote("PETR4.SA")

    assert result is None


def test_fetch_quote_exception_returns_none():
    with patch("app.services.quotes.yf") as mock_yf, \
            patch("app.services.quotes.YFINANCE_AVAILABLE", True):
        mock_yf.Ticker.side_effect = Exception("network error")
        result = fetch_quote("PETR4.SA")

    assert result is None
