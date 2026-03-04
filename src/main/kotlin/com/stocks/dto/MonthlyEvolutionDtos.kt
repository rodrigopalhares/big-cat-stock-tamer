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
)

data class MonthlyEvolutionRow(
    val month: LocalDate,
    val snapshots: List<MonthlySnapshotResponse>,
    val totalInvested: Double,
    val totalMarketValue: Double,
)

data class MonthlyEvolutionSummary(
    val months: List<MonthlyEvolutionRow>,
    val tickers: List<String>,
)
