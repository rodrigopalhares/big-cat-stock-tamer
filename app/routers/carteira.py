from typing import List
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Ativo, Transacao
from app.schemas import PosicaoAtivo, ResumoCarteira
from app.services.calculos import calcular_posicao, calcular_tir, calcular_lucro_nao_realizado
from app.services.cotacoes import buscar_cotacao

router = APIRouter(prefix="/carteira", tags=["carteira"])
templates = Jinja2Templates(directory="app/templates")


def montar_posicoes(ativos: List[Ativo], buscar_cotacoes: bool = False) -> List[PosicaoAtivo]:
    posicoes = []
    for ativo in ativos:
        if not ativo.transacoes:
            continue

        calc = calcular_posicao(ativo.transacoes)

        if calc["quantidade"] <= 0 and calc["lucro_realizado"] == 0:
            continue

        cotacao = buscar_cotacao(ativo.ticker) if buscar_cotacoes else None
        lucro_nao_real = None
        if cotacao and calc["quantidade"] > 0:
            lucro_nao_real = calcular_lucro_nao_realizado(
                calc["quantidade"], calc["preco_medio"], cotacao
            )

        valor_atual = (cotacao * calc["quantidade"]) if cotacao and calc["quantidade"] > 0 else None

        tir = None
        if calc["fluxos"]:
            tir = calcular_tir(calc["fluxos"], valor_atual)

        posicoes.append(
            PosicaoAtivo(
                ticker=ativo.ticker,
                nome=ativo.nome,
                tipo=ativo.tipo,
                quantidade=calc["quantidade"],
                preco_medio=calc["preco_medio"],
                custo_total=calc["custo_total"],
                valor_atual=valor_atual,
                lucro_nao_realizado=lucro_nao_real,
                lucro_realizado=calc["lucro_realizado"],
                tir=tir,
            )
        )

    return posicoes


# --- HTML Routes ---

@router.get("/", response_class=HTMLResponse)
def dashboard_html(request: Request, db: Session = Depends(get_db)):
    ativos = db.query(Ativo).all()
    posicoes = montar_posicoes(ativos, buscar_cotacoes=False)

    total_investido = sum(p.custo_total for p in posicoes)
    lucro_realizado = sum(p.lucro_realizado for p in posicoes)
    valor_atual = None
    lucro_nao_realizado = None

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "posicoes": posicoes,
            "total_investido": total_investido,
            "lucro_realizado": lucro_realizado,
            "valor_atual": valor_atual,
            "lucro_nao_realizado": lucro_nao_realizado,
        },
    )


# --- JSON API Routes ---

@router.get("/api", response_model=ResumoCarteira)
def resumo_carteira(db: Session = Depends(get_db)):
    ativos = db.query(Ativo).all()
    posicoes = montar_posicoes(ativos, buscar_cotacoes=True)

    total_investido = sum(p.custo_total for p in posicoes)
    lucro_realizado = sum(p.lucro_realizado for p in posicoes)
    valores = [p.valor_atual for p in posicoes if p.valor_atual is not None]
    valor_atual = sum(valores) if valores else None
    lucros_nr = [p.lucro_nao_realizado for p in posicoes if p.lucro_nao_realizado is not None]
    lucro_nao_realizado = sum(lucros_nr) if lucros_nr else None

    return ResumoCarteira(
        total_investido=total_investido,
        valor_atual=valor_atual,
        lucro_realizado=lucro_realizado,
        lucro_nao_realizado=lucro_nao_realizado,
        posicoes=posicoes,
    )


@router.get("/api/{ticker}", response_model=PosicaoAtivo)
def posicao_ativo(ticker: str, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    ativo = db.query(Ativo).filter(Ativo.ticker == ticker.upper()).first()
    if not ativo:
        raise HTTPException(status_code=404, detail="Ativo não encontrado")
    posicoes = montar_posicoes([ativo], buscar_cotacoes=True)
    if not posicoes:
        raise HTTPException(status_code=404, detail="Sem transações para este ativo")
    return posicoes[0]
