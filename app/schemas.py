from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, field_validator


class AtivoBase(BaseModel):
    ticker: str
    nome: Optional[str] = None
    tipo: Optional[str] = None


class AtivoCreate(AtivoBase):
    @field_validator("ticker")
    @classmethod
    def ticker_upper(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("tipo")
    @classmethod
    def tipo_valido(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in ("ACAO", "FII", "ETF", "BDR"):
            raise ValueError("tipo deve ser ACAO, FII, ETF ou BDR")
        return v


class AtivoOut(AtivoBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class TransacaoBase(BaseModel):
    ativo_id: int
    tipo: str
    quantidade: float
    preco: float
    taxas: float = 0.0
    data: date
    corretora: Optional[str] = None
    notas: Optional[str] = None


class TransacaoCreate(TransacaoBase):
    @field_validator("tipo")
    @classmethod
    def tipo_valido(cls, v: str) -> str:
        v = v.upper().strip()
        if v not in ("COMPRA", "VENDA"):
            raise ValueError("tipo deve ser COMPRA ou VENDA")
        return v

    @field_validator("quantidade", "preco")
    @classmethod
    def positivo(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("deve ser maior que zero")
        return v


class TransacaoOut(TransacaoBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class PosicaoAtivo(BaseModel):
    ticker: str
    nome: Optional[str]
    tipo: Optional[str]
    quantidade: float
    preco_medio: float
    custo_total: float
    valor_atual: Optional[float] = None
    lucro_nao_realizado: Optional[float] = None
    lucro_realizado: float
    tir: Optional[float] = None


class ResumoCarteira(BaseModel):
    total_investido: float
    valor_atual: Optional[float]
    lucro_realizado: float
    lucro_nao_realizado: Optional[float]
    posicoes: List[PosicaoAtivo]
