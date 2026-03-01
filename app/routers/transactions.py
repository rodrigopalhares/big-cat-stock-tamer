from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset, Transaction
from app.schemas import TransactionCreate, TransactionOut

router = APIRouter(prefix="/transactions", tags=["transactions"])
templates = Jinja2Templates(directory="app/templates")


# --- HTML Routes ---

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
    asset_id: int = Form(...),
    type: str = Form(...),
    quantity: float = Form(...),
    price: float = Form(...),
    fees: float = Form(0.0),
    date: date = Form(...),
    broker: str = Form(""),
    notes: str = Form(""),
    db: Session = Depends(get_db),
):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    transaction = Transaction(
        asset_id=asset_id,
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
