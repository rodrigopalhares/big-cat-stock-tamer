from typing import Optional

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False


def buscar_cotacao(ticker: str) -> Optional[float]:
    """
    Busca cotação atual de um ativo via yfinance.
    Para ações brasileiras adiciona .SA ao ticker.
    Retorna None se não conseguir buscar.
    """
    if not YFINANCE_AVAILABLE:
        return None

    # Tickers brasileiros precisam do sufixo .SA no Yahoo Finance
    yf_ticker = ticker if "." in ticker else f"{ticker}.SA"

    try:
        info = yf.Ticker(yf_ticker).fast_info
        preco = getattr(info, "last_price", None)
        if preco and preco > 0:
            return float(preco)
    except Exception:
        pass

    return None
