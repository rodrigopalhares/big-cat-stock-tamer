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

    # OOB swaps: fill name, type, yf_ticker and currency fields
    type_options = "".join(
        f'<option value="{t}"{"selected" if t == info["type"] else ""}>{t}</option>'
        for t in ASSET_TYPES
    )
    currency = info.get("currency", "BRL")
    currency_options = (
        f'<option value="BRL"{"selected" if currency == "BRL" else ""}>BRL — Real</option>'
        f'<option value="USD"{"selected" if currency == "USD" else ""}>USD — Dólar</option>'
    )
    name_val = info["name"] if found else ""
    oob = (
        f'<input hx-swap-oob="true" id="assetName" type="text" name="name" '
        f'class="form-control" placeholder="Ex: Petrobras PN" value="{name_val}">'
        f'<select hx-swap-oob="true" id="assetType" name="type" class="form-select">'
        f'{type_options}'
        f'</select>'
        f'<input hx-swap-oob="true" id="assetYfTicker" type="hidden" name="yf_ticker" value="{info["yf_ticker"]}">'
        f'<select hx-swap-oob="true" id="assetCurrency" name="currency" class="form-select">'
        f'{currency_options}'
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
    yf_ticker: str = Form(""),
    currency: str = Form("BRL"),
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
        name = info["name"] if info["name"] != ticker else ""
        type = type or info["type"]
        yf_ticker = yf_ticker or info["yf_ticker"]
        currency = currency or info.get("currency", "BRL")

    asset = Asset(
        ticker=ticker,
        yf_ticker=yf_ticker or None,
        name=name or None,
        type=type or "STOCK",
        currency=currency or "BRL",
    )
    db.add(asset)
    db.commit()
    return RedirectResponse(url="/assets/", status_code=303)


@router.post("/{ticker}/edit")
def edit_asset(
    ticker: str,
    name: str = Form(""),
    type: str = Form("STOCK"),
    yf_ticker: str = Form(""),
    currency: str = Form("BRL"),
    db: Session = Depends(get_db),
):
    asset = db.query(Asset).filter(Asset.ticker == ticker.upper()).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.name = name or None
    asset.type = type or "STOCK"
    asset.yf_ticker = yf_ticker or None
    asset.currency = currency or "BRL"
    db.commit()
    return RedirectResponse(url="/assets/", status_code=303)


@router.post("/{ticker}/delete")
def delete_asset(ticker: str, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.ticker == ticker.upper()).first()
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


@router.get("/api/{ticker}", response_model=AssetOut)
def get_asset(ticker: str, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.ticker == ticker.upper()).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset
