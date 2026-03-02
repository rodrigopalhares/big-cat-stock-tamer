from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, field_validator


class AssetBase(BaseModel):
    ticker: str
    yf_ticker: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    currency: str = "BRL"


class AssetCreate(AssetBase):
    @field_validator("ticker")
    @classmethod
    def ticker_upper(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("type")
    @classmethod
    def type_valid(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in ("STOCK", "REIT", "ETF", "BDR"):
            raise ValueError("type must be STOCK, REIT, ETF or BDR")
        return v


class AssetOut(AssetBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class TransactionBase(BaseModel):
    asset_id: int
    type: str
    quantity: float
    price: float
    fees: float = 0.0
    date: date
    broker: Optional[str] = None
    notes: Optional[str] = None


class TransactionCreate(TransactionBase):
    @field_validator("type")
    @classmethod
    def type_valid(cls, v: str) -> str:
        v = v.upper().strip()
        if v not in ("BUY", "SELL"):
            raise ValueError("type must be BUY or SELL")
        return v

    @field_validator("quantity", "price")
    @classmethod
    def must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("must be greater than zero")
        return v


class TransactionOut(TransactionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class AssetPosition(BaseModel):
    ticker: str
    name: Optional[str]
    type: Optional[str]
    quantity: float
    avg_price: float
    total_cost: float
    current_price: Optional[float] = None   # market price per share
    current_value: Optional[float] = None   # current_price × quantity
    unrealized_pnl: Optional[float] = None
    realized_pnl: float
    irr: Optional[float] = None
    irr_monthly: Optional[float] = None
    irr_annual: Optional[float] = None
    currency: str = "BRL"
    exchange_rate: Optional[float] = None       # USD→BRL rate (if currency != BRL)
    current_value_brl: Optional[float] = None   # current_value converted to BRL
    unrealized_pnl_brl: Optional[float] = None  # unrealized_pnl converted to BRL


class PortfolioSummary(BaseModel):
    total_invested: float
    current_value: Optional[float]
    realized_pnl: float
    unrealized_pnl: Optional[float]
    positions: List[AssetPosition]
