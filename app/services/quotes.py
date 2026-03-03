from datetime import datetime, timezone, date as date_type
from typing import Optional, List, Dict, Tuple
import logging
import pandas as pd

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


def fetch_historical_quotes_batch(
    yf_ticker_map: Dict[str, str], start_date: date_type
) -> Dict[str, List[Tuple[date_type, float]]]:
    """
    Fetch historical close prices for multiple yfinance tickers in a single request.

    Args:
        yf_ticker_map: mapping of {yf_ticker: asset_ticker}
        start_date: earliest date to fetch (inclusive)

    Returns:
        {asset_ticker: [(date, close), ...]} sorted ascending by date
    """
    if not YFINANCE_AVAILABLE or not yf_ticker_map:
        return {}

    try:
        tickers_str = " ".join(yf_ticker_map.keys())
        raw = yf.download(tickers_str, start=start_date.isoformat(), auto_adjust=True, progress=False)

        if raw.empty:
            return {}

        # yf.download returns MultiIndex columns when multiple tickers are requested
        close = raw["Close"] if "Close" in raw.columns else raw

        results: Dict[str, List[Tuple[date_type, float]]] = {}
        for yf_ticker, asset_ticker in yf_ticker_map.items():
            try:
                if isinstance(close.columns, pd.MultiIndex):
                    series = close[yf_ticker] if yf_ticker in close.columns else None
                else:
                    # single ticker: close is a Series
                    series = close if len(yf_ticker_map) == 1 else close.get(yf_ticker)

                if series is None:
                    continue

                records = []
                for ts, val in series.dropna().items():
                    if hasattr(ts, "date"):
                        d = ts.date()
                    else:
                        d = ts
                    if float(val) > 0:
                        records.append((d, float(val)))
                if records:
                    results[asset_ticker] = sorted(records, key=lambda x: x[0])
            except Exception as e:
                logger.warning(f"Error extracting historical data for {yf_ticker}: {e}")

        return results
    except Exception as e:
        logger.warning(f"Error fetching historical quotes batch: {e}")
        return {}


_td_full_cache: dict = {"df": None, "timestamp": 0}


def _get_td_full_dataframe() -> pd.DataFrame:
    """
    Fetch the complete (all dates) Tesouro Direto prices CSV.
    Cached for 1 hour.
    """
    now = datetime.now(timezone.utc).timestamp()
    if _td_full_cache["df"] is not None and (now - _td_full_cache["timestamp"]) < 3600:
        return _td_full_cache["df"]

    url = (
        "https://www.tesourotransparente.gov.br/ckan/dataset/"
        "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
        "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"
    )
    try:
        df = pd.read_csv(url, sep=";", decimal=",")
        df["Data Base"] = pd.to_datetime(df["Data Base"], format="%d/%m/%Y")
        _td_full_cache["df"] = df
        _td_full_cache["timestamp"] = now
        return df
    except Exception as e:
        logger.error(f"Error fetching full Tesouro Direto CSV: {e}")
        return pd.DataFrame()


def fetch_td_historical_quotes_batch(
    yf_tickers: List[str],
) -> Dict[str, List[Tuple[date_type, float]]]:
    """
    Fetch full price history for Tesouro Direto assets.

    Args:
        yf_tickers: list of yf_ticker strings in 'Tipo Titulo;dd/mm/yyyy' format

    Returns:
        {yf_ticker: [(date, close), ...]} sorted ascending by date
    """
    if not yf_tickers:
        return {}

    df = _get_td_full_dataframe()
    if df.empty:
        return {}

    results: Dict[str, List[Tuple[date_type, float]]] = {}
    for yf_ticker in yf_tickers:
        try:
            if ";" not in yf_ticker:
                logger.warning(f"Invalid TD yf_ticker format: {yf_ticker}")
                continue

            title, maturity = yf_ticker.split(";", 1)
            mask = (df["Tipo Titulo"] == title) & (df["Data Vencimento"] == maturity)
            matched = df.loc[mask, ["Data Base", "PU Compra Manha"]].dropna()

            records = []
            for _, row in matched.iterrows():
                val = row["PU Compra Manha"]
                if pd.notna(val) and float(val) > 0:
                    records.append((row["Data Base"].date(), float(val)))

            if records:
                results[yf_ticker] = sorted(records, key=lambda x: x[0])
        except Exception as e:
            logger.warning(f"Error extracting TD historical data for {yf_ticker}: {e}")

    return results


_td_cache: dict = {"df": None, "timestamp": 0}

def _get_td_dataframe() -> pd.DataFrame:
    """
    Fetch the latest Tesouro Direto prices from the Tesouro Transparente Open Data CSV.
    Caches the results for 1 hour to prevent redundant heavy downloads.
    """
    now = datetime.now(timezone.utc).timestamp()
    if _td_cache["df"] is not None and (now - _td_cache["timestamp"]) < 3600:
        return _td_cache["df"]

    url = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv'
    try:
        df = pd.read_csv(url, sep=';', decimal=',')
        df['Data Base'] = pd.to_datetime(df['Data Base'], format='%d/%m/%Y')
        latest_date = df['Data Base'].max()
        df_latest = df[df['Data Base'] == latest_date].copy()

        _td_cache["df"] = df_latest
        _td_cache["timestamp"] = now
        return df_latest
    except Exception as e:
        logger.error(f"Error fetching Tesouro Direto CSV: {e}")
        return pd.DataFrame()

def fetch_td_quotes_batch(yf_tickers: List[str]) -> Dict[str, float]:
    """
    Given a list of Tesouro Direto yf_ticker values (format: 'Tipo Titulo;dd/mm/yyyy'),
    looks them up in the cached CSV matching both 'Tipo Titulo' and 'Data Vencimento',
    and returns their 'PU Compra Manha' price keyed by the yf_ticker string.
    """
    if not yf_tickers:
        return {}

    df = _get_td_dataframe()
    if df.empty:
        return {}

    results = {}
    for yf_ticker in yf_tickers:
        try:
            if ';' not in yf_ticker:
                logger.warning(f"Invalid TD yf_ticker format (expected 'Title;dd/mm/yyyy'): {yf_ticker}")
                continue

            title, maturity = yf_ticker.split(';', 1)
            mask = (df['Tipo Titulo'] == title) & (df['Data Vencimento'] == maturity)
            matched = df.loc[mask, 'PU Compra Manha']

            if not matched.empty:
                price = matched.iloc[0]
                if pd.notna(price) and price > 0:
                    results[yf_ticker] = float(price)
        except Exception as e:
            logger.warning(f"Error parsing TD quote for {yf_ticker}: {e}")

    return results
