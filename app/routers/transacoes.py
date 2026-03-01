from typing import List
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Ativo, Transacao
from app.schemas import TransacaoCreate, TransacaoOut

router = APIRouter(prefix="/transacoes", tags=["transacoes"])
templates = Jinja2Templates(directory="app/templates")


# --- HTML Routes ---

@router.get("/", response_class=HTMLResponse)
def listar_transacoes_html(
    request: Request,
    ativo_id: int = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transacao).order_by(Transacao.data.desc(), Transacao.id.desc())
    if ativo_id:
        query = query.filter(Transacao.ativo_id == ativo_id)
    transacoes = query.all()
    ativos = db.query(Ativo).order_by(Ativo.ticker).all()
    return templates.TemplateResponse(
        "transacoes.html",
        {
            "request": request,
            "transacoes": transacoes,
            "ativos": ativos,
            "ativo_id_filtro": ativo_id,
            "hoje": date.today().isoformat(),
        },
    )


@router.post("/nova", response_class=HTMLResponse)
def criar_transacao_form(
    request: Request,
    ativo_id: int = Form(...),
    tipo: str = Form(...),
    quantidade: float = Form(...),
    preco: float = Form(...),
    taxas: float = Form(0.0),
    data: date = Form(...),
    corretora: str = Form(""),
    notas: str = Form(""),
    db: Session = Depends(get_db),
):
    ativo = db.query(Ativo).filter(Ativo.id == ativo_id).first()
    if not ativo:
        raise HTTPException(status_code=404, detail="Ativo não encontrado")

    transacao = Transacao(
        ativo_id=ativo_id,
        tipo=tipo.upper(),
        quantidade=quantidade,
        preco=preco,
        taxas=taxas,
        data=data,
        corretora=corretora or None,
        notas=notas or None,
    )
    db.add(transacao)
    db.commit()
    return RedirectResponse(url="/transacoes/", status_code=303)


@router.post("/{transacao_id}/excluir")
def excluir_transacao(transacao_id: int, db: Session = Depends(get_db)):
    t = db.query(Transacao).filter(Transacao.id == transacao_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    db.delete(t)
    db.commit()
    return RedirectResponse(url="/transacoes/", status_code=303)


# --- JSON API Routes ---

@router.get("/api", response_model=List[TransacaoOut])
def listar_transacoes(ativo_id: int = None, db: Session = Depends(get_db)):
    query = db.query(Transacao).order_by(Transacao.data.desc())
    if ativo_id:
        query = query.filter(Transacao.ativo_id == ativo_id)
    return query.all()


@router.post("/api", response_model=TransacaoOut, status_code=201)
def criar_transacao(t: TransacaoCreate, db: Session = Depends(get_db)):
    ativo = db.query(Ativo).filter(Ativo.id == t.ativo_id).first()
    if not ativo:
        raise HTTPException(status_code=404, detail="Ativo não encontrado")
    nova = Transacao(**t.model_dump())
    db.add(nova)
    db.commit()
    db.refresh(nova)
    return nova


@router.delete("/api/{transacao_id}", status_code=204)
def deletar_transacao(transacao_id: int, db: Session = Depends(get_db)):
    t = db.query(Transacao).filter(Transacao.id == transacao_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    db.delete(t)
    db.commit()
