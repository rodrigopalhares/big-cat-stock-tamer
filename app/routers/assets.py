from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset
from app.schemas import AssetCreate, AssetOut

router = APIRouter(prefix="/assets", tags=["assets"])
templates = Jinja2Templates(directory="app/templates")

ASSET_TYPES = ["STOCK", "REIT", "ETF", "BDR"]


# --- HTML Routes ---

@router.get("/", response_class=HTMLResponse)
def list_assets(request: Request, db: Session = Depends(get_db)):
    assets = db.query(Asset).order_by(Asset.ticker).all()
    return templates.TemplateResponse(
        "assets.html",
        {"request": request, "assets": assets, "asset_types": ASSET_TYPES},
    )


@router.post("/new", response_class=HTMLResponse)
def create_asset_form(
    request: Request,
    ticker: str = Form(...),
    name: str = Form(""),
    type: str = Form("STOCK"),
    db: Session = Depends(get_db),
):
    ticker = ticker.upper().strip()
    existing = db.query(Asset).filter(Asset.ticker == ticker).first()
    if existing:
        assets = db.query(Asset).order_by(Asset.ticker).all()
        return templates.TemplateResponse(
            "assets.html",
            {
                "request": request,
                "assets": assets,
                "asset_types": ASSET_TYPES,
                "error": f"Ativo '{ticker}' já cadastrado.",
            },
        )
    asset = Asset(ticker=ticker, name=name or None, type=type or None)
    db.add(asset)
    db.commit()
    return RedirectResponse(url="/assets/", status_code=303)


@router.post("/{asset_id}/delete")
def delete_asset(asset_id: int, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    db.delete(asset)
    db.commit()
    return RedirectResponse(url="/assets/", status_code=303)


# --- JSON API Routes ---

@router.get("/api", response_model=List[AssetOut])
def list_assets_api(db: Session = Depends(get_db)):
    return db.query(Asset).order_by(Asset.ticker).all()


@router.post("/api", response_model=AssetOut, status_code=201)
def create_asset(asset: AssetCreate, db: Session = Depends(get_db)):
    existing = db.query(Asset).filter(Asset.ticker == asset.ticker).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ticker already registered")
    new_asset = Asset(**asset.model_dump())
    db.add(new_asset)
    db.commit()
    db.refresh(new_asset)
    return new_asset


@router.get("/api/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset
