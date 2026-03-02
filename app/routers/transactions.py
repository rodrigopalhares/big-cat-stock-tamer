from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset, Transaction
from app.schemas import TransactionCreate, TransactionOut
from app.services.quotes import fetch_asset_info

router = APIRouter(prefix="/transactions", tags=["transactions"])
templates = Jinja2Templates(directory="app/templates")


# --- HTML Routes ---

@router.get("/ticker-info", response_class=HTMLResponse)
def ticker_info(ticker: str = "", db: Session = Depends(get_db)):
    """HTMX endpoint: returns an inline preview card for the given ticker."""
    ticker = ticker.upper().strip()
    if len(ticker) < 3:
        return HTMLResponse("")

    existing = db.query(Asset).filter(Asset.ticker == ticker).first()
    if existing:
        return HTMLResponse(
            f'<div class="alert alert-success small p-2 mb-0">'
            f'<i class="bi bi-check-circle-fill me-1"></i>'
            f'<strong>{existing.ticker}</strong>'
            f'{" — " + existing.name if existing.name else ""} '
            f'<span class="badge bg-secondary">{existing.type or "STOCK"}</span>'
            f'<span class="text-muted ms-2">já cadastrado</span>'
            f"</div>"
        )

    info = fetch_asset_info(ticker)
    found = info["name"] != ticker
    if found:
        return HTMLResponse(
            f'<div class="alert alert-info small p-2 mb-0">'
            f'<i class="bi bi-cloud-download me-1"></i>'
            f'<strong>{ticker}</strong> — {info["name"]} '
            f'<span class="badge bg-secondary">{info["type"]}</span>'
            f'<span class="text-muted ms-2">será cadastrado automaticamente</span>'
            f"</div>"
        )

    return HTMLResponse(
        f'<div class="alert alert-warning small p-2 mb-0">'
        f'<i class="bi bi-question-circle me-1"></i>'
        f'<strong>{ticker}</strong>'
        f'<span class="text-muted ms-2">não encontrado na internet — será criado mesmo assim</span>'
        f"</div>"
    )


@router.get("/", response_class=HTMLResponse)
def list_transactions(
    request: Request,
    asset_id: Optional[int] = None,
    ticker: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction).order_by(Transaction.date.desc(), Transaction.id.desc())
    if asset_id:
        query = query.filter(Transaction.asset_id == asset_id)
    elif ticker:
        query = query.join(Transaction.asset).filter(Asset.ticker == ticker.upper())
    transactions = query.all()
    assets = db.query(Asset).order_by(Asset.ticker).all()
    return templates.TemplateResponse(
        "transactions.html",
        {
            "request": request,
            "transactions": transactions,
            "assets": assets,
            "asset_id_filter": asset_id,
            "today": date.today().isoformat(),
        },
    )


@router.post("/new", response_class=HTMLResponse)
def create_transaction_form(
    request: Request,
    ticker: str = Form(...),
    type: str = Form(...),
    quantity: float = Form(...),
    price: Optional[float] = Form(None),
    total_price: Optional[float] = Form(None),
    fees: float = Form(0.0),
    date: date = Form(...),
    broker: str = Form(""),
    notes: str = Form(""),
    db: Session = Depends(get_db),
):
    ticker = ticker.upper().strip()

    # Resolve price / fees from total_price when provided
    if total_price is not None and total_price > 0:
        if price:
            # Both given: derive fees from the difference
            fees = total_price - quantity * price
        else:
            # Only total given: derive unit price after fees
            price = (total_price - fees) / quantity

    if not price or price <= 0:
        raise HTTPException(status_code=400, detail="Informe o preço unitário ou o valor total")

    asset = db.query(Asset).filter(Asset.ticker == ticker).first()
    if not asset:
        info = fetch_asset_info(ticker)
        asset = Asset(
            ticker=ticker,
            name=info["name"] if info["name"] != ticker else None,
            type=info["type"],
        )
        db.add(asset)
        db.flush()

    transaction = Transaction(
        asset_id=asset.id,
        type=type.upper(),
        quantity=quantity,
        price=price,
        fees=fees,
        date=date,
        broker=broker or None,
        notes=notes or None,
    )
    db.add(transaction)
    db.commit()
    return RedirectResponse(url="/transactions/", status_code=303)


@router.post("/{transaction_id}/delete")
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    t = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(t)
    db.commit()
    return RedirectResponse(url="/transactions/", status_code=303)


# --- JSON API Routes ---

@router.get("/api", response_model=List[TransactionOut])
def list_transactions_api(asset_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Transaction).order_by(Transaction.date.desc())
    if asset_id:
        query = query.filter(Transaction.asset_id == asset_id)
    return query.all()


@router.post("/api", response_model=TransactionOut, status_code=201)
def create_transaction(t: TransactionCreate, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == t.asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    new_t = Transaction(**t.model_dump())
    db.add(new_t)
    db.commit()
    db.refresh(new_t)
    return new_t


@router.delete("/api/{transaction_id}", status_code=204)
def delete_transaction_api(transaction_id: int, db: Session = Depends(get_db)):
    t = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(t)
    db.commit()
