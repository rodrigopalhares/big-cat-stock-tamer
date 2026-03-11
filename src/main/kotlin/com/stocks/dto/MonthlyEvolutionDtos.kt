package com.stocks.dto

import java.time.LocalDate

data class MonthlySnapshotResponse(
    val assetId: String,
    val month: LocalDate,
    val quantity: Double,
    val avgPrice: Double,
    val marketPrice: Double,
    val totalCost: Double,
    val marketValue: Double,
    val accumulatedNetDividends: Double = 0.0,
)

data class MonthlyEvolutionRow(
    val month: LocalDate,
    val snapshots: List<MonthlySnapshotResponse>,
    val totalInvested: Double,
    val totalMarketValue: Double,
    val totalMonthlyNetDividends: Double = 0.0,
    val totalAccumulatedNetDividends: Double = 0.0,
)

data class MonthlyEvolutionSummary(
    val months: List<MonthlyEvolutionRow>,
    val tickers: List<String>,
)
