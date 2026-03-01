from typing import List, Optional, Tuple
import numpy_financial as npf
from app.models import Transaction


def calculate_position(transactions: List[Transaction]) -> dict:
    """
    Compute weighted average price, current quantity, realized P&L
    and cash flows from a list of transactions.

    Returns a dict with:
      - quantity: current holdings
      - avg_price: weighted average purchase price
      - total_cost: total cost basis of current holdings
      - realized_pnl: profit/loss from all completed sales
      - cash_flows: list of (date, value) tuples for IRR calculation
    """
    quantity = 0.0
    accumulated_cost = 0.0
    realized_pnl = 0.0
    cash_flows: List[Tuple] = []

    for t in sorted(transactions, key=lambda x: x.date):
        if t.type == "BUY":
            purchase_cost = t.quantity * t.price + t.fees
            accumulated_cost += purchase_cost
            quantity += t.quantity
            cash_flows.append((t.date, -purchase_cost))
        elif t.type == "SELL" and quantity > 0:
            avg_price = accumulated_cost / quantity
            sale_proceeds = t.quantity * t.price - t.fees
            cost_of_sold = avg_price * t.quantity
            realized_pnl += sale_proceeds - cost_of_sold
            accumulated_cost -= cost_of_sold
            quantity -= t.quantity
            cash_flows.append((t.date, sale_proceeds))

    if quantity < 0:
        quantity = 0.0

    avg_price = accumulated_cost / quantity if quantity > 0 else 0.0

    return {
        "quantity": quantity,
        "avg_price": avg_price,
        "total_cost": accumulated_cost,
        "realized_pnl": realized_pnl,
        "cash_flows": cash_flows,
    }


def calculate_irr(cash_flows: List[Tuple], current_value: Optional[float] = None) -> Optional[float]:
    """
    Compute the Internal Rate of Return (IRR) from a list of cash flows.
    Purchases are negative, sales are positive.
    If current_value is provided, it is appended as the final positive cash flow.
    Returns the IRR as a decimal (e.g. 0.15 = 15%) or None if it does not converge.
    """
    if not cash_flows:
        return None

    values = [v for _, v in cash_flows]

    if current_value is not None and current_value > 0:
        values.append(current_value)

    if len(values) < 2:
        return None

    try:
        irr = npf.irr(values)
        if irr is None or irr != irr:  # NaN check
            return None
        return float(irr)
    except Exception:
        return None


def calculate_unrealized_pnl(quantity: float, avg_price: float, current_price: float) -> float:
    """Unrealized profit/loss based on current market price."""
    return (current_price - avg_price) * quantity
