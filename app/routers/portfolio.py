from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset
from app.schemas import AssetPosition, PortfolioSummary
from app.services.calculations import calculate_position, calculate_irr, calculate_unrealized_pnl
from app.services.quotes import fetch_quote

router = APIRouter(prefix="/portfolio", tags=["portfolio"])
templates = Jinja2Templates(directory="app/templates")


def build_positions(assets: List[Asset], fetch_quotes: bool = False) -> List[AssetPosition]:
    positions = []
    for asset in assets:
        if not asset.transactions:
            continue

        calc = calculate_position(asset.transactions)

        if calc["quantity"] <= 0 and calc["realized_pnl"] == 0:
            continue

        quote = fetch_quote(asset.ticker) if fetch_quotes else None
        current_price = quote
        unrealized_pnl = None
        if current_price and calc["quantity"] > 0:
            unrealized_pnl = calculate_unrealized_pnl(calc["quantity"], calc["avg_price"], current_price)

        current_value = (current_price * calc["quantity"]) if current_price and calc["quantity"] > 0 else None

        irr = None
        if calc["cash_flows"]:
            irr = calculate_irr(calc["cash_flows"], current_value)

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
            )
        )

    return positions


# --- HTML Routes ---

@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request, db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    positions = build_positions(assets, fetch_quotes=True)

    total_invested = sum(p.total_cost for p in positions)
    realized_pnl = sum(p.realized_pnl for p in positions)
    values = [p.current_value for p in positions if p.current_value is not None]
    current_value = sum(values) if values else None
    unrealized = [p.unrealized_pnl for p in positions if p.unrealized_pnl is not None]
    unrealized_pnl = sum(unrealized) if unrealized else None

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "positions": positions,
            "total_invested": total_invested,
            "realized_pnl": realized_pnl,
            "current_value": current_value,
            "unrealized_pnl": unrealized_pnl,
        },
    )


# --- JSON API Routes ---

@router.get("/api", response_model=PortfolioSummary)
def portfolio_summary(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    positions = build_positions(assets, fetch_quotes=True)

    total_invested = sum(p.total_cost for p in positions)
    realized_pnl = sum(p.realized_pnl for p in positions)
    values = [p.current_value for p in positions if p.current_value is not None]
    current_value = sum(values) if values else None
    unrealized = [p.unrealized_pnl for p in positions if p.unrealized_pnl is not None]
    unrealized_pnl = sum(unrealized) if unrealized else None

    return PortfolioSummary(
        total_invested=total_invested,
        current_value=current_value,
        realized_pnl=realized_pnl,
        unrealized_pnl=unrealized_pnl,
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
