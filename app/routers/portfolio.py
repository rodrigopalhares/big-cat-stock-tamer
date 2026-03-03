from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Asset
from app.schemas import AssetPosition, PortfolioSummary
from app.services.portfolio_service import build_positions, _aggregate_positions

router = APIRouter(prefix="/portfolio", tags=["portfolio"])
templates = Jinja2Templates(directory="app/templates")


# --- HTML Routes ---

@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request, db: Session = Depends(get_db)):
    assets = db.query(Asset).options(selectinload(Asset.transactions)).all()
    positions = build_positions(assets, fetch_quotes=True, db=db)

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
    assets = db.query(Asset).options(selectinload(Asset.transactions)).all()
    positions = build_positions(assets, fetch_quotes=True, db=db)

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
    asset = db.query(Asset).options(selectinload(Asset.transactions)).filter(Asset.ticker == ticker.upper()).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    positions = build_positions([asset], fetch_quotes=True)
    if not positions:
        raise HTTPException(status_code=404, detail="No transactions found for this asset")
    return positions[0]
