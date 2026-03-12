package com.stocks.service

import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.abs

data class PositionCalcResult(
    val quantity: Double,
    val avgPrice: Double,
    val totalCost: Double,
    val realizedPnl: Double,
    val cashFlows: List<Pair<LocalDate, Double>>,
    val totalCostBrl: Double = totalCost,
    val realizedPnlBrl: Double = realizedPnl,
    val cashFlowsBrl: List<Pair<LocalDate, Double>> = cashFlows,
    val avgPriceBrl: Double = avgPrice,
)

@Service
class CalculationService {
    fun calculatePosition(transactions: List<TransactionData>): PositionCalcResult {
        var quantity = 0.0
        var accumulatedCost = 0.0
        var realizedPnl = 0.0
        val cashFlows = mutableListOf<Pair<LocalDate, Double>>()

        var accumulatedCostBrl = 0.0
        var realizedPnlBrl = 0.0
        val cashFlowsBrl = mutableListOf<Pair<LocalDate, Double>>()

        for (t in transactions.sortedBy { it.date }) {
            val absQty = abs(t.quantity)
            if (t.quantity > 0) { // BUY
                val purchaseCost = absQty * t.price + t.fees
                accumulatedCost += purchaseCost
                quantity += absQty
                cashFlows.add(t.date to -purchaseCost)

                val purchaseCostBrl = absQty * t.priceBrl + t.feesBrl
                accumulatedCostBrl += purchaseCostBrl
                cashFlowsBrl.add(t.date to -purchaseCostBrl)
            } else if (t.quantity < 0 && quantity > 0) { // SELL
                val avgPrice = accumulatedCost / quantity
                val avgPriceBrl = accumulatedCostBrl / quantity

                val saleProceeds = absQty * t.price - t.fees
                val costOfSold = avgPrice * absQty
                realizedPnl += saleProceeds - costOfSold
                accumulatedCost -= costOfSold

                val saleProceedsBrl = absQty * t.priceBrl - t.feesBrl
                val costOfSoldBrl = avgPriceBrl * absQty
                realizedPnlBrl += saleProceedsBrl - costOfSoldBrl
                accumulatedCostBrl -= costOfSoldBrl

                quantity -= absQty
                cashFlows.add(t.date to saleProceeds)
                cashFlowsBrl.add(t.date to saleProceedsBrl)
            }
        }

        if (quantity < 0) quantity = 0.0
        val avgPrice = if (quantity > 0) accumulatedCost / quantity else 0.0
        val avgPriceBrl = if (quantity > 0) accumulatedCostBrl / quantity else 0.0

        return PositionCalcResult(
            quantity = quantity,
            avgPrice = avgPrice,
            totalCost = accumulatedCost,
            realizedPnl = realizedPnl,
            cashFlows = cashFlows,
            totalCostBrl = accumulatedCostBrl,
            realizedPnlBrl = realizedPnlBrl,
            cashFlowsBrl = cashFlowsBrl,
            avgPriceBrl = avgPriceBrl,
        )
    }

    fun calculateIrr(
        cashFlows: List<Pair<LocalDate, Double>>,
        currentValue: Double? = null
    ): Double? {
        if (cashFlows.isEmpty()) return null

        val values = cashFlows.map { it.second }.toMutableList()
        if (currentValue != null && currentValue > 0) {
            values.add(currentValue)
        }

        if (values.size < 2) return null

        return try {
            val irr = computeIrr(values)
            if (irr.isNaN() || irr.isInfinite()) null else irr
        } catch (e: Exception) {
            null
        }
    }

    fun calculateUnrealizedPnl(
        quantity: Double,
        avgPrice: Double,
        currentPrice: Double
    ): Double = (currentPrice - avgPrice) * quantity

    fun calculateXirr(
        cashFlows: List<Pair<LocalDate, Double>>,
        currentValue: Double? = null
    ): Double? {
        if (cashFlows.isEmpty()) return null

        val flows = cashFlows.toMutableList()
        if (currentValue != null && currentValue > 0) {
            flows.add(LocalDate.now() to currentValue)
        }

        if (flows.size < 2) return null

        val values = flows.map { it.second }
        val hasNegative = values.any { it < 0 }
        val hasPositive = values.any { it > 0 }
        if (!hasNegative || !hasPositive) return null

        return try {
            xirr(flows)
        } catch (e: Exception) {
            null
        }
    }

    // Newton-Raphson IRR computation
    private fun computeIrr(
        values: List<Double>,
        guess: Double = 0.1,
        maxIterations: Int = 200,
        tolerance: Double = 1e-7
    ): Double {
        var rate = guess
        for (i in 0 until maxIterations) {
            var npv = 0.0
            var dnpv = 0.0
            for ((j, value) in values.withIndex()) {
                npv += value / Math.pow(1 + rate, j.toDouble())
                dnpv -= j * value / Math.pow(1 + rate, (j + 1).toDouble())
            }
            if (Math.abs(dnpv) < 1e-12) break
            val newRate = rate - npv / dnpv
            if (Math.abs(newRate - rate) < tolerance) return newRate
            rate = newRate
        }
        return rate
    }

    // XIRR via bisection (same algorithm as the Python version)
    private fun xirr(flows: List<Pair<LocalDate, Double>>): Double? {
        val ref = flows[0].first

        fun npv(rate: Double): Double =
            flows.sumOf { (date, value) ->
                val days = ChronoUnit.DAYS.between(ref, date).toDouble()
                value / Math.pow(1 + rate, days / 365.0)
            }

        var lo = -0.9999
        var hi = 100.0
        var npvLo = npv(lo)
        val npvHi = npv(hi)

        if (npvLo * npvHi > 0) return null

        for (i in 0 until 200) {
            val mid = (lo + hi) / 2.0
            val npvMid = npv(mid)
            if (Math.abs(npvMid) < 1e-7 || (hi - lo) < 1e-9) return mid
            if (npvLo * npvMid < 0) {
                hi = mid
            } else {
                lo = mid
                npvLo = npvMid
            }
        }
        return (lo + hi) / 2.0
    }
}

// Simple data holder for transaction info needed by CalculationService
data class TransactionData(
    val type: String,
    val quantity: Double,
    val price: Double,
    val fees: Double,
    val date: LocalDate,
    val priceBrl: Double = price,
    val feesBrl: Double = fees,
)
