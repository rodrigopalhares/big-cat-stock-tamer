from datetime import datetime, timezone
from typing import Optional, List, Dict
import logging

logger = logging.getLogger(__name__)

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False

_rate_cache: dict = {}  # {"USD_BRL": (rate, timestamp)}


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

            currency = (data.get("currency") or "BRL").upper()
            if currency not in ("BRL", "USD"):
                currency = "BRL"
            return {"name": name, "type": asset_type, "yf_ticker": yf_ticker, "currency": currency}
        except Exception:
            continue

    return {"name": ticker, "type": "STOCK", "yf_ticker": fallback_yf, "currency": "BRL"}


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
    except Exception as e:
        logger.warning(f"Error fetching quote for {yf_ticker}: {e}")

    return None


def fetch_quotes_batch(yf_tickers: List[str]) -> Dict[str, float]:
    """
    Fetch current prices for multiple Yahoo Finance tickers in a single request.
    Returns a dictionary mapping yf_ticker to its price.
    """
    if not YFINANCE_AVAILABLE or not yf_tickers:
        return {}

    try:
        tickers_str = " ".join(yf_tickers)
        tickers = yf.Tickers(tickers_str)
        results = {}
        for ticker_symbol in yf_tickers:
            try:
                info = tickers.tickers[ticker_symbol].fast_info
                price = getattr(info, "last_price", None)
                if price and price > 0:
                    results[ticker_symbol] = float(price)
            except Exception as e:
                logger.warning(f"Error extracting batch quote for {ticker_symbol}: {e}")
                continue
        return results
    except Exception as e:
        logger.warning(f"Error fetching batch quotes: {e}")
        return {}


def fetch_exchange_rate(from_currency: str, to_currency: str = "BRL") -> float:
    """Return how many `to_currency` units equal 1 `from_currency`.

    Results are cached for 5 minutes. Falls back to the last known rate or 6.0.
    """
    if from_currency == to_currency:
        return 1.0

    key = f"{from_currency}_{to_currency}"
    now = datetime.now(timezone.utc).timestamp()

    cached = _rate_cache.get(key)
    if cached and now - cached[1] < 300:
        return cached[0]

    if YFINANCE_AVAILABLE:
        try:
            yf_pair = f"{from_currency}{to_currency}=X"
            ticker = yf.Ticker(yf_pair)
            rate = ticker.fast_info.last_price
            if rate and rate > 0:
                _rate_cache[key] = (float(rate), now)
                return float(rate)
        except Exception:
            pass

    # fallback: last known value or 6.0
    return _rate_cache.get(key, (6.0, 0))[0]
