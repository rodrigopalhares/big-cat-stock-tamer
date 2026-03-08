package com.stocks.dto

data class AssetPosition(
    val ticker: String,
    val name: String?,
    val type: String?,
    val quantity: Double,
    val avgPrice: Double,
    val totalCost: Double,
    val currentPrice: Double? = null,
    val currentValue: Double? = null,
    val unrealizedPnl: Double? = null,
    val realizedPnl: Double,
    val irr: Double? = null,
    val irrMonthly: Double? = null,
    val irrAnnual: Double? = null,
    val dividendPnl: Double = 0.0,
    val currency: String = "BRL",
    val exchangeRate: Double? = null,
    val currentValueBrl: Double? = null,
    val unrealizedPnlBrl: Double? = null,
)

data class PortfolioSummary(
    val totalInvested: Double,
    val currentValue: Double?,
    val realizedPnl: Double,
    val unrealizedPnl: Double?,
    val dividendPnl: Double = 0.0,
    val positions: List<AssetPosition>,
)
