from typing import Optional

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False


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
