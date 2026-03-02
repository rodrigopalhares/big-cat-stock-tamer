from dataclasses import dataclass
from datetime import date

import pytest

from app.services.calculations import (
    calculate_irr,
    calculate_position,
    calculate_unrealized_pnl,
    calculate_xirr,
)


@dataclass
class MockTransaction:
    type: str
    quantity: float
    price: float
    fees: float
    date: date


# ---------------------------------------------------------------------------
# calculate_position
# ---------------------------------------------------------------------------


def test_position_single_buy():
    txs = [MockTransaction("BUY", 10, 10.0, 0.0, date(2024, 1, 1))]
    result = calculate_position(txs)
    assert result["quantity"] == 10.0
    assert result["avg_price"] == pytest.approx(10.0)
    assert result["total_cost"] == pytest.approx(100.0)
    assert result["realized_pnl"] == pytest.approx(0.0)


def test_position_buy_with_fees():
    txs = [MockTransaction("BUY", 10, 10.0, 5.0, date(2024, 1, 1))]
    result = calculate_position(txs)
    assert result["avg_price"] == pytest.approx(10.5)
    assert result["total_cost"] == pytest.approx(105.0)


def test_position_two_buys_weighted_average():
    txs = [
        MockTransaction("BUY", 10, 10.0, 0.0, date(2024, 1, 1)),
        MockTransaction("BUY", 10, 20.0, 0.0, date(2024, 1, 2)),
    ]
    result = calculate_position(txs)
    assert result["avg_price"] == pytest.approx(15.0)
    assert result["quantity"] == pytest.approx(20.0)


def test_position_buy_then_sell_profit():
    txs = [
        MockTransaction("BUY", 10, 10.0, 0.0, date(2024, 1, 1)),
        MockTransaction("SELL", 10, 15.0, 0.0, date(2024, 1, 2)),
    ]
    result = calculate_position(txs)
    assert result["realized_pnl"] == pytest.approx(50.0)
    assert result["quantity"] == pytest.approx(0.0)


def test_position_buy_then_sell_loss():
    txs = [
        MockTransaction("BUY", 10, 10.0, 0.0, date(2024, 1, 1)),
        MockTransaction("SELL", 10, 8.0, 0.0, date(2024, 1, 2)),
    ]
    result = calculate_position(txs)
    assert result["realized_pnl"] == pytest.approx(-20.0)


def test_position_sell_without_buy():
    txs = [MockTransaction("SELL", 10, 15.0, 0.0, date(2024, 1, 1))]
    result = calculate_position(txs)
    assert result["quantity"] == pytest.approx(0.0)
    assert result["realized_pnl"] == pytest.approx(0.0)


def test_position_empty_list():
    result = calculate_position([])
    assert result["quantity"] == 0.0
    assert result["avg_price"] == 0.0
    assert result["total_cost"] == 0.0
    assert result["realized_pnl"] == 0.0


def test_position_cash_flows_signs():
    txs = [
        MockTransaction("BUY", 10, 10.0, 0.0, date(2024, 1, 1)),
        MockTransaction("SELL", 5, 15.0, 0.0, date(2024, 1, 2)),
    ]
    result = calculate_position(txs)
    flows = result["cash_flows"]
    assert len(flows) == 2
    assert flows[0][1] < 0  # BUY is negative
    assert flows[1][1] > 0  # SELL is positive


# ---------------------------------------------------------------------------
# calculate_unrealized_pnl
# ---------------------------------------------------------------------------


def test_unrealized_pnl_profit():
    assert calculate_unrealized_pnl(10, 10.0, 15.0) == pytest.approx(50.0)


def test_unrealized_pnl_loss():
    assert calculate_unrealized_pnl(10, 10.0, 8.0) == pytest.approx(-20.0)


def test_unrealized_pnl_breakeven():
    assert calculate_unrealized_pnl(10, 10.0, 10.0) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# calculate_irr
# ---------------------------------------------------------------------------


def test_irr_empty_flows():
    assert calculate_irr([]) is None


def test_irr_single_flow():
    assert calculate_irr([(date(2024, 1, 1), -100.0)]) is None


def test_irr_valid_flows():
    flows = [
        (date(2024, 1, 1), -100.0),
        (date(2024, 6, 1), 120.0),
    ]
    result = calculate_irr(flows)
    assert result is not None
    assert isinstance(result, float)


def test_irr_with_current_value_appended():
    flows = [(date(2024, 1, 1), -100.0)]
    result_without = calculate_irr(flows)           # None — single flow
    result_with = calculate_irr(flows, current_value=120.0)  # two values now
    assert result_without is None
    assert result_with is not None


# ---------------------------------------------------------------------------
# calculate_xirr
# ---------------------------------------------------------------------------


def test_xirr_empty_flows():
    assert calculate_xirr([]) is None


def test_xirr_single_flow():
    assert calculate_xirr([(date(2024, 1, 1), -100.0)]) is None


def test_xirr_all_negative():
    flows = [
        (date(2024, 1, 1), -100.0),
        (date(2024, 2, 1), -50.0),
    ]
    assert calculate_xirr(flows) is None


def test_xirr_all_positive():
    flows = [
        (date(2024, 1, 1), 100.0),
        (date(2024, 2, 1), 50.0),
    ]
    assert calculate_xirr(flows) is None


def test_xirr_valid_buy_and_sell():
    flows = [
        (date(2024, 1, 1), -1000.0),
        (date(2025, 1, 1), 1200.0),
    ]
    result = calculate_xirr(flows)
    assert result is not None
    assert isinstance(result, float)
    assert result > 0  # profitable trade
