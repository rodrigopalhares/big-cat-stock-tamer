from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Ativo
from app.schemas import AtivoCreate, AtivoOut

router = APIRouter(prefix="/ativos", tags=["ativos"])
templates = Jinja2Templates(directory="app/templates")

TIPOS_ATIVO = ["ACAO", "FII", "ETF", "BDR"]


# --- HTML Routes ---

@router.get("/", response_class=HTMLResponse)
def listar_ativos_html(request: Request, db: Session = Depends(get_db)):
    ativos = db.query(Ativo).order_by(Ativo.ticker).all()
    return templates.TemplateResponse(
        "ativos.html",
        {"request": request, "ativos": ativos, "tipos": TIPOS_ATIVO},
    )


@router.post("/novo", response_class=HTMLResponse)
def criar_ativo_form(
    request: Request,
    ticker: str = Form(...),
    nome: str = Form(""),
    tipo: str = Form("ACAO"),
    db: Session = Depends(get_db),
):
    ticker = ticker.upper().strip()
    existente = db.query(Ativo).filter(Ativo.ticker == ticker).first()
    if existente:
        ativos = db.query(Ativo).order_by(Ativo.ticker).all()
        return templates.TemplateResponse(
            "ativos.html",
            {
                "request": request,
                "ativos": ativos,
                "tipos": TIPOS_ATIVO,
                "erro": f"Ativo '{ticker}' já cadastrado.",
            },
        )
    ativo = Ativo(ticker=ticker, nome=nome or None, tipo=tipo or None)
    db.add(ativo)
    db.commit()
    return RedirectResponse(url="/ativos/", status_code=303)


@router.post("/{ativo_id}/excluir")
def excluir_ativo(ativo_id: int, db: Session = Depends(get_db)):
    ativo = db.query(Ativo).filter(Ativo.id == ativo_id).first()
    if not ativo:
        raise HTTPException(status_code=404, detail="Ativo não encontrado")
    db.delete(ativo)
    db.commit()
    return RedirectResponse(url="/ativos/", status_code=303)


# --- JSON API Routes ---

@router.get("/api", response_model=List[AtivoOut])
def listar_ativos(db: Session = Depends(get_db)):
    return db.query(Ativo).order_by(Ativo.ticker).all()


@router.post("/api", response_model=AtivoOut, status_code=201)
def criar_ativo(ativo: AtivoCreate, db: Session = Depends(get_db)):
    existente = db.query(Ativo).filter(Ativo.ticker == ativo.ticker).first()
    if existente:
        raise HTTPException(status_code=409, detail="Ticker já cadastrado")
    novo = Ativo(**ativo.model_dump())
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return novo


@router.get("/api/{ativo_id}", response_model=AtivoOut)
def obter_ativo(ativo_id: int, db: Session = Depends(get_db)):
    ativo = db.query(Ativo).filter(Ativo.id == ativo_id).first()
    if not ativo:
        raise HTTPException(status_code=404, detail="Ativo não encontrado")
    return ativo
