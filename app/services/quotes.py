from typing import Optional

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False


def fetch_asset_info(ticker: str) -> dict:
    """
    Fetch asset name, type and resolved Yahoo Finance ticker for a given symbol.

    Resolution strategy (when no suffix is present):
      1. Try <ticker>.SA  (Brazilian stocks on B3)
      2. Try bare <ticker> (international / already-suffixed)
    Returns the first candidate that yields a valid longName/shortName.

    Returns a dict with 'name', 'type' (STOCK/REIT/ETF/BDR) and 'yf_ticker'.
    Falls back gracefully on any error.
    """
    fallback_yf = f"{ticker}.SA" if "." not in ticker else ticker

    if not YFINANCE_AVAILABLE:
        return {"name": ticker, "type": "STOCK", "yf_ticker": fallback_yf}

    candidates = [f"{ticker}.SA", ticker] if "." not in ticker else [ticker]

    for yf_ticker in candidates:
        try:
            data = yf.Ticker(yf_ticker).info
            name = data.get("longName") or data.get("shortName")
            if not name:
                continue  # no useful data — try next candidate

            quote_type = (data.get("quoteType") or "").upper()
            sector = (data.get("sector") or "").lower()

            if quote_type == "ETF":
                asset_type = "ETF"
            elif quote_type == "EQUITY" and "real estate" in sector:
                asset_type = "REIT"
            else:
                asset_type = "STOCK"

            return {"name": name, "type": asset_type, "yf_ticker": yf_ticker}
        except Exception:
            continue

    return {"name": ticker, "type": "STOCK", "yf_ticker": fallback_yf}


def fetch_quote(yf_ticker: str) -> Optional[float]:
    """
    Fetch the current price using the pre-resolved Yahoo Finance ticker.
    Callers should pass asset.yf_ticker directly — no suffix guessing here.
    Returns None if the price cannot be retrieved.
    """
    if not YFINANCE_AVAILABLE:
        return None

    try:
        info = yf.Ticker(yf_ticker).fast_info
        price = getattr(info, "last_price", None)
        if price and price > 0:
            return float(price)
    except Exception:
        pass

    return None
