from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset
from app.schemas import AssetCreate, AssetOut
from app.services.quotes import fetch_asset_info

router = APIRouter(prefix="/assets", tags=["assets"])
templates = Jinja2Templates(directory="app/templates")

ASSET_TYPES = ["STOCK", "REIT", "ETF", "BDR"]


# --- HTML Routes ---

@router.get("/ticker-info", response_class=HTMLResponse)
def ticker_info(ticker: str = "", db: Session = Depends(get_db)):
    """HTMX endpoint: preview card + OOB swaps to fill name and type fields."""
    ticker = ticker.upper().strip()
    if len(ticker) < 3:
        return HTMLResponse("")

    existing = db.query(Asset).filter(Asset.ticker == ticker).first()
    if existing:
        return HTMLResponse(
            f'<div class="alert alert-warning small p-2 mb-0">'
            f'<i class="bi bi-exclamation-circle me-1"></i>'
            f'<strong>{existing.ticker}</strong> já cadastrado'
            f'</div>'
        )

    info = fetch_asset_info(ticker)
    found = info["name"] != ticker

    if found:
        preview = (
            f'<div class="alert alert-info small p-2 mb-0">'
            f'<i class="bi bi-cloud-download me-1"></i>'
            f'<strong>{ticker}</strong> — {info["name"]} '
            f'<span class="badge bg-secondary">{info["type"]}</span>'
            f'</div>'
        )
    else:
        preview = (
            f'<div class="alert alert-secondary small p-2 mb-0">'
            f'<i class="bi bi-question-circle me-1"></i>'
            f'<strong>{ticker}</strong> não encontrado na internet'
            f'</div>'
        )

    # OOB swaps: fill name input and select the correct type
    type_options = "".join(
        f'<option value="{t}"{"selected" if t == info["type"] else ""}>{t}</option>'
        for t in ASSET_TYPES
    )
    name_val = info["name"] if found else ""
    oob = (
        f'<input hx-swap-oob="true" id="assetName" type="text" name="name" '
        f'class="form-control" placeholder="Ex: Petrobras PN" value="{name_val}">'
        f'<select hx-swap-oob="true" id="assetType" name="type" class="form-select">'
        f'{type_options}'
        f'</select>'
    )
    return HTMLResponse(preview + oob)


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
    if not name:
        info = fetch_asset_info(ticker)
        if info["name"] != ticker:
            name = info["name"]
        if not type:
            type = info["type"]

    asset = Asset(ticker=ticker, name=name or None, type=type or "STOCK")
    db.add(asset)
    db.commit()
    return RedirectResponse(url="/assets/", status_code=303)


@router.post("/{asset_id}/edit")
def edit_asset(
    asset_id: int,
    name: str = Form(""),
    type: str = Form("STOCK"),
    db: Session = Depends(get_db),
):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.name = name or None
    asset.type = type or "STOCK"
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
