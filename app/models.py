from datetime import datetime, date
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class Ativo(Base):
    __tablename__ = "ativos"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, unique=True, nullable=False, index=True)
    nome = Column(String)
    tipo = Column(String)  # ACAO, FII, ETF, BDR
    created_at = Column(DateTime, default=datetime.utcnow)

    transacoes = relationship("Transacao", back_populates="ativo")


class Transacao(Base):
    __tablename__ = "transacoes"

    id = Column(Integer, primary_key=True, index=True)
    ativo_id = Column(Integer, ForeignKey("ativos.id"), nullable=False)
    tipo = Column(String, nullable=False)  # COMPRA ou VENDA
    quantidade = Column(Float, nullable=False)
    preco = Column(Float, nullable=False)
    taxas = Column(Float, default=0.0)
    data = Column(Date, nullable=False)
    corretora = Column(String)
    notas = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    ativo = relationship("Ativo", back_populates="transacoes")
