from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset
from app.schemas import AssetPosition, PortfolioSummary
from app.services.calculations import calculate_position, calculate_irr, calculate_unrealized_pnl, calculate_xirr
from app.services.quotes import fetch_quote, fetch_exchange_rate

router = APIRouter(prefix="/portfolio", tags=["portfolio"])
templates = Jinja2Templates(directory="app/templates")


def _aggregate_positions(positions: List[AssetPosition]) -> dict:
    total_invested = sum(
        (p.total_cost * p.exchange_rate if p.exchange_rate else p.total_cost)
        for p in positions
    )
    realized_pnl = sum(
        (p.realized_pnl * p.exchange_rate if p.exchange_rate else p.realized_pnl)
        for p in positions
    )
    values_brl = [p.current_value_brl for p in positions if p.current_value_brl is not None]
    current_value = sum(values_brl) if values_brl else None
    unrealized_brl = [p.unrealized_pnl_brl for p in positions if p.unrealized_pnl_brl is not None]
    unrealized_pnl = sum(unrealized_brl) if unrealized_brl else None
    return {
        "total_invested": total_invested,
        "realized_pnl": realized_pnl,
        "current_value": current_value,
        "unrealized_pnl": unrealized_pnl,
    }


def build_positions(assets: List[Asset], fetch_quotes: bool = False) -> List[AssetPosition]:
    positions = []
    for asset in assets:
        if not asset.transactions:
            continue

        calc = calculate_position(asset.transactions)

        if calc["quantity"] <= 0 and calc["realized_pnl"] == 0:
            continue

        yf_ticker = asset.yf_ticker or (asset.ticker if "." in asset.ticker else f"{asset.ticker}.SA")
        quote = fetch_quote(yf_ticker) if fetch_quotes else None
        current_price = quote
        unrealized_pnl = None
        if current_price and calc["quantity"] > 0:
            unrealized_pnl = calculate_unrealized_pnl(calc["quantity"], calc["avg_price"], current_price)

        current_value = (current_price * calc["quantity"]) if current_price and calc["quantity"] > 0 else None

        irr = None
        irr_annual = None
        irr_monthly = None
        if calc["cash_flows"]:
            irr = calculate_irr(calc["cash_flows"], current_value)
            irr_annual = calculate_xirr(calc["cash_flows"], current_value)
            if irr_annual is not None:
                irr_monthly = (1 + irr_annual) ** (1 / 12) - 1

        currency = asset.currency or "BRL"
        exchange_rate = fetch_exchange_rate(currency) if currency != "BRL" else None
        current_value_brl = (current_value * exchange_rate) if exchange_rate and current_value is not None else current_value
        unrealized_pnl_brl = (unrealized_pnl * exchange_rate) if exchange_rate and unrealized_pnl is not None else unrealized_pnl

        positions.append(
            AssetPosition(
                ticker=asset.ticker,
                name=asset.name,
                type=asset.type,
                quantity=calc["quantity"],
                avg_price=calc["avg_price"],
                total_cost=calc["total_cost"],
                current_price=current_price,
                current_value=current_value,
                unrealized_pnl=unrealized_pnl,
                realized_pnl=calc["realized_pnl"],
                irr=irr,
                irr_annual=irr_annual,
                irr_monthly=irr_monthly,
                currency=currency,
                exchange_rate=exchange_rate,
                current_value_brl=current_value_brl,
                unrealized_pnl_brl=unrealized_pnl_brl,
            )
        )

    return positions


# --- HTML Routes ---

@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request, db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    positions = build_positions(assets, fetch_quotes=True)

    agg = _aggregate_positions(positions)
    total_invested = agg["total_invested"]
    realized_pnl = agg["realized_pnl"]
    current_value = agg["current_value"]
    unrealized_pnl = agg["unrealized_pnl"]

    # collect unique exchange rates used (for display)
    usd_rate = next(
        (p.exchange_rate for p in positions if p.currency == "USD" and p.exchange_rate),
        None,
    )
    has_usd = any(p.currency == "USD" for p in positions)

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "positions": positions,
            "total_invested": total_invested,
            "realized_pnl": realized_pnl,
            "current_value": current_value,
            "unrealized_pnl": unrealized_pnl,
            "has_usd": has_usd,
            "usd_rate": usd_rate,
        },
    )


# --- JSON API Routes ---

@router.get("/api", response_model=PortfolioSummary)
def portfolio_summary(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    positions = build_positions(assets, fetch_quotes=True)

    agg = _aggregate_positions(positions)

    return PortfolioSummary(
        total_invested=agg["total_invested"],
        current_value=agg["current_value"],
        realized_pnl=agg["realized_pnl"],
        unrealized_pnl=agg["unrealized_pnl"],
        positions=positions,
    )


@router.get("/api/{ticker}", response_model=AssetPosition)
def asset_position(ticker: str, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.ticker == ticker.upper()).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    positions = build_positions([asset], fetch_quotes=True)
    if not positions:
        raise HTTPException(status_code=404, detail="No transactions found for this asset")
    return positions[0]
