from typing import Optional

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False


def fetch_asset_info(ticker: str) -> dict:
    """
    Fetch asset name and type from yfinance for a given ticker.
    Brazilian tickers automatically receive the .SA suffix.
    Returns a dict with 'name' and 'type' (STOCK/REIT/ETF/BDR).
    Falls back to {'name': ticker, 'type': 'STOCK'} on any error.
    """
    if not YFINANCE_AVAILABLE:
        return {"name": ticker, "type": "STOCK"}

    yf_ticker = ticker if "." in ticker else f"{ticker}.SA"

    try:
        data = yf.Ticker(yf_ticker).info
        name = data.get("longName") or data.get("shortName") or ticker
        quote_type = (data.get("quoteType") or "").upper()
        sector = (data.get("sector") or "").lower()

        if quote_type == "ETF":
            asset_type = "ETF"
        elif quote_type == "EQUITY" and "real estate" in sector:
            asset_type = "REIT"
        else:
            asset_type = "STOCK"

        return {"name": name, "type": asset_type}
    except Exception:
        return {"name": ticker, "type": "STOCK"}


def fetch_quote(ticker: str) -> Optional[float]:
    """
    Fetch the current price for a given ticker via yfinance.
    Brazilian tickers automatically receive the .SA suffix for Yahoo Finance.
    Returns None if the price cannot be retrieved.
    """
    if not YFINANCE_AVAILABLE:
        return None

    # Brazilian tickers require the .SA suffix on Yahoo Finance
    yf_ticker = ticker if "." in ticker else f"{ticker}.SA"

    try:
        info = yf.Ticker(yf_ticker).fast_info
        price = getattr(info, "last_price", None)
        if price and price > 0:
            return float(price)
    except Exception:
        pass

    return None
