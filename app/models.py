from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship, validates
from app.database import Base


class Asset(Base):
    __tablename__ = "assets"

    ticker = Column(String, primary_key=True, nullable=False)
    yf_ticker = Column(String)  # resolved Yahoo Finance symbol (e.g. PETR4.SA)
    name = Column(String)
    type = Column(String)  # STOCK, REIT, ETF, BDR
    currency = Column(String, default="BRL")  # ISO 4217: BRL or USD
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("Transaction", back_populates="asset", cascade="all, delete-orphan")

    @validates("ticker")
    def _normalize_ticker(self, key, value):
        return value.upper().strip() if value else value


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(String, ForeignKey("assets.ticker"), nullable=False)  # str FK → ticker
    type = Column(String, nullable=False)  # BUY or SELL
    quantity = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    fees = Column(Float, default=0.0)
    date = Column(Date, nullable=False)
    broker = Column(String)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    asset = relationship("Asset", back_populates="transactions")
