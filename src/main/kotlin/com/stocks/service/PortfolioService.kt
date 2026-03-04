package com.stocks.service

import com.stocks.dto.AssetPosition
import com.stocks.dto.PortfolioSummary
import com.stocks.model.AssetEntity
import org.springframework.stereotype.Service

@Service
class PortfolioService(
    private val calculationService: CalculationService,
    private val quoteService: QuoteService,
    private val priceHistoryService: PriceHistoryService,
) {
    fun buildPositions(
        assets: List<AssetEntity>,
        fetchQuotes: Boolean = false,
    ): List<AssetPosition> {
        val positions = mutableListOf<AssetPosition>()

        // Pre-fetch live quotes if requested
        val liveQuotes = mutableMapOf<String, Double>()
        if (fetchQuotes) {
            val yfTickers = mutableListOf<String>()
            val tdTickers = mutableListOf<String>()

            for (asset in assets) {
                val ticker = asset.ticker.value
                if (asset.transactions.empty()) continue
                if (asset.type == "TESOURO_DIRETO") {
                    if (asset.yfTicker != null) tdTickers.add(asset.yfTicker!!)
                } else {
                    yfTickers.add(resolveYfTicker(ticker, asset.yfTicker))
                }
            }

            if (yfTickers.isNotEmpty()) {
                liveQuotes.putAll(quoteService.fetchQuotesBatch(yfTickers))
            }
            if (tdTickers.isNotEmpty()) {
                liveQuotes.putAll(quoteService.fetchTdQuotesBatch(tdTickers))
            }
        }

        for (asset in assets) {
            val ticker = asset.ticker.value
            val txList = asset.transactions.toList()
            if (txList.isEmpty()) continue

            val transactionData =
                txList.map {
                    TransactionData(
                        type = it.type,
                        quantity = it.quantity,
                        price = it.price,
                        fees = it.fees,
                        date = it.date,
                    )
                }

            val calc = calculationService.calculatePosition(transactionData)
            if (calc.quantity <= 0 && calc.realizedPnl == 0.0) continue

            // Resolve current price: prefer DB, fall back to live
            var currentPrice: Double? = priceHistoryService.getLatestPrice(ticker)

            if (currentPrice == null && fetchQuotes) {
                currentPrice =
                    if (asset.type == "TESOURO_DIRETO") {
                        asset.yfTicker?.let { liveQuotes[it] }
                    } else {
                        liveQuotes[resolveYfTicker(ticker, asset.yfTicker)]
                    }
            }

            val unrealizedPnl =
                if (currentPrice != null && calc.quantity > 0) {
                    calculationService.calculateUnrealizedPnl(calc.quantity, calc.avgPrice, currentPrice)
                } else {
                    null
                }

            val currentValue =
                if (currentPrice != null && calc.quantity > 0) {
                    currentPrice * calc.quantity
                } else {
                    null
                }

            val irr = calculationService.calculateIrr(calc.cashFlows, currentValue)
            val irrAnnual = calculationService.calculateXirr(calc.cashFlows, currentValue)
            val irrMonthly = irrAnnual?.let { Math.pow(1 + it, 1.0 / 12.0) - 1 }

            val currency = asset.currency
            val exchangeRate = if (currency != "BRL") quoteService.fetchExchangeRate(currency) else null
            val currentValueBrl =
                if (exchangeRate != null && currentValue != null) {
                    currentValue * exchangeRate
                } else {
                    currentValue
                }
            val unrealizedPnlBrl =
                if (exchangeRate != null && unrealizedPnl != null) {
                    unrealizedPnl * exchangeRate
                } else {
                    unrealizedPnl
                }

            positions.add(
                AssetPosition(
                    ticker = ticker,
                    name = asset.name,
                    type = asset.type,
                    quantity = calc.quantity,
                    avgPrice = calc.avgPrice,
                    totalCost = calc.totalCost,
                    currentPrice = currentPrice,
                    currentValue = currentValue,
                    unrealizedPnl = unrealizedPnl,
                    realizedPnl = calc.realizedPnl,
                    irr = irr,
                    irrAnnual = irrAnnual,
                    irrMonthly = irrMonthly,
                    currency = currency,
                    exchangeRate = exchangeRate,
                    currentValueBrl = currentValueBrl,
                    unrealizedPnlBrl = unrealizedPnlBrl,
                )
            )
        }

        return positions
    }

    fun aggregatePositions(positions: List<AssetPosition>): PortfolioSummary {
        val totalInvested =
            positions.sumOf { p ->
                if (p.exchangeRate != null) p.totalCost * p.exchangeRate else p.totalCost
            }
        val realizedPnl =
            positions.sumOf { p ->
                if (p.exchangeRate != null) p.realizedPnl * p.exchangeRate else p.realizedPnl
            }
        val valuesBrl = positions.mapNotNull { it.currentValueBrl }
        val currentValue = if (valuesBrl.isNotEmpty()) valuesBrl.sum() else null
        val unrealizedBrl = positions.mapNotNull { it.unrealizedPnlBrl }
        val unrealizedPnl = if (unrealizedBrl.isNotEmpty()) unrealizedBrl.sum() else null

        return PortfolioSummary(
            totalInvested = totalInvested,
            currentValue = currentValue,
            realizedPnl = realizedPnl,
            unrealizedPnl = unrealizedPnl,
            positions = positions,
        )
    }
}
