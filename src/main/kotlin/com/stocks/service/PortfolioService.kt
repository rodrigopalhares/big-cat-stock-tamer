package com.stocks.service

import com.stocks.dto.AssetPosition
import com.stocks.dto.NO_QUOTE_TYPES
import com.stocks.dto.PortfolioSummary
import com.stocks.model.AssetEntity
import org.springframework.stereotype.Service
import java.time.LocalDate

@Service
class PortfolioService(
    private val calculationService: CalculationService,
    private val quoteService: QuoteService,
    private val priceHistoryService: PriceHistoryService,
    private val dividendService: DividendService,
    private val exchangeRateService: ExchangeRateService,
) {
    fun buildPositions(
        assets: List<AssetEntity>,
        fetchQuotes: Boolean = false,
    ): List<AssetPosition> {
        val positions = mutableListOf<AssetPosition>()

        // Pre-fetch quotes: use DB prices for today first, only call API for missing ones
        val liveQuotes = mutableMapOf<String, Double>()
        if (fetchQuotes) {
            val today = LocalDate.now()

            // Collect all quotable tickers and map yfTicker -> assetTicker
            val yfTickerToAsset = mutableMapOf<String, String>()
            val tdTickerToAsset = mutableMapOf<String, String>()

            for (asset in assets) {
                val ticker = asset.ticker.value
                if (asset.transactions.empty()) continue
                if (asset.delisted) continue
                if (asset.type in NO_QUOTE_TYPES) continue
                if (asset.type == "TESOURO_DIRETO") {
                    if (asset.yfTicker != null) tdTickerToAsset[asset.yfTicker!!] = ticker
                } else {
                    yfTickerToAsset[resolveYfTicker(ticker, asset.yfTicker)] = ticker
                }
            }

            // Check which assets already have today's price in DB
            val allAssetTickers = yfTickerToAsset.values + tdTickerToAsset.values
            val todayPrices =
                if (allAssetTickers.isNotEmpty()) {
                    priceHistoryService.getPricesForDate(allAssetTickers.toList(), today)
                } else {
                    emptyMap()
                }

            // Populate liveQuotes from DB and filter out tickers that already have today's price
            val yfTickersToFetch = mutableListOf<String>()
            for ((yfTicker, assetTicker) in yfTickerToAsset) {
                val dbPrice = todayPrices[assetTicker]
                if (dbPrice != null) {
                    liveQuotes[yfTicker] = dbPrice
                } else {
                    yfTickersToFetch.add(yfTicker)
                }
            }

            val tdTickersToFetch = mutableListOf<String>()
            for ((tdTicker, assetTicker) in tdTickerToAsset) {
                val dbPrice = todayPrices[assetTicker]
                if (dbPrice != null) {
                    liveQuotes[tdTicker] = dbPrice
                } else {
                    tdTickersToFetch.add(tdTicker)
                }
            }

            // Fetch only missing quotes from API and save to DB
            if (yfTickersToFetch.isNotEmpty()) {
                val fetched = quoteService.fetchQuotesBatch(yfTickersToFetch)
                liveQuotes.putAll(fetched)
                val records =
                    fetched.mapNotNull { (yfTicker, price) ->
                        val assetTicker = yfTickerToAsset[yfTicker] ?: return@mapNotNull null
                        PriceRecord(assetTicker, today, price)
                    }
                priceHistoryService.upsertPrices(records)
            }
            if (tdTickersToFetch.isNotEmpty()) {
                val fetched = quoteService.fetchTdQuotesBatch(tdTickersToFetch)
                liveQuotes.putAll(fetched)
                val records =
                    fetched.mapNotNull { (tdTicker, price) ->
                        val assetTicker = tdTickerToAsset[tdTicker] ?: return@mapNotNull null
                        PriceRecord(assetTicker, today, price)
                    }
                priceHistoryService.upsertPrices(records)
            }
        }

        val dividendPnlByAsset = dividendService.getDividendPnlByAsset()
        val dividendCashFlowsByAsset = dividendService.getDividendCashFlowsByAsset()

        for (asset in assets) {
            val ticker = asset.ticker.value
            if (!asset.hasPosition && asset.realizedPnl == 0.0) continue

            // Resolve current price: when fetching quotes, prefer live/today's price; otherwise use latest from DB
            val currentPrice: Double? =
                if (fetchQuotes) {
                    val liveKey =
                        if (asset.type == "TESOURO_DIRETO") {
                            asset.yfTicker
                        } else if (asset.type !in NO_QUOTE_TYPES) {
                            resolveYfTicker(ticker, asset.yfTicker)
                        } else {
                            null
                        }
                    liveKey?.let { liveQuotes[it] } ?: priceHistoryService.getLatestPrice(ticker)
                } else {
                    priceHistoryService.getLatestPrice(ticker)
                }

            val unrealizedPnl =
                if (currentPrice != null && asset.hasPosition) {
                    calculationService.calculateUnrealizedPnl(asset.quantity, asset.avgPrice, currentPrice)
                } else {
                    null
                }

            val currentValue =
                if (currentPrice != null && asset.hasPosition) {
                    currentPrice * asset.quantity
                } else {
                    null
                }

            val dividendPnl = dividendPnlByAsset[ticker] ?: 0.0
            val dividendCashFlows = dividendCashFlowsByAsset[ticker] ?: emptyList()

            // Cash flows still needed from transactions for XIRR calculation
            val txCashFlows = calculationService.buildCashFlows(asset.transactions.toList())
            val allCashFlows = (txCashFlows.cashFlows + dividendCashFlows).sortedBy { it.first }
            val allCashFlowsBrl = (txCashFlows.cashFlowsBrl + dividendCashFlows).sortedBy { it.first }

            val irr = calculationService.calculateIrr(allCashFlows, currentValue)
            val irrAnnual = calculationService.calculateXirr(allCashFlows, currentValue)
            val irrMonthly = irrAnnual?.let { Math.pow(1 + it, 1.0 / 12.0) - 1 }

            val currency = asset.currency
            val exchangeRate = if (currency != "BRL") exchangeRateService.getRate(currency) else null
            val currentPriceBrl =
                if (exchangeRate != null && currentPrice != null) {
                    currentPrice * exchangeRate
                } else {
                    currentPrice
                }
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
                    quantity = asset.quantity,
                    avgPrice = asset.avgPrice,
                    avgPriceBrl = asset.avgPriceBrl,
                    totalCost = asset.totalCost,
                    totalCostBrl = asset.totalCostBrl,
                    currentPrice = currentPrice,
                    currentPriceBrl = currentPriceBrl,
                    currentValue = currentValue,
                    unrealizedPnl = unrealizedPnl,
                    realizedPnl = asset.realizedPnl,
                    realizedPnlBrl = asset.realizedPnlBrl,
                    dividendPnl = dividendPnl,
                    irr = irr,
                    irrAnnual = irrAnnual,
                    irrMonthly = irrMonthly,
                    currency = currency,
                    exchangeRate = exchangeRate,
                    currentValueBrl = currentValueBrl,
                    unrealizedPnlBrl = unrealizedPnlBrl,
                    delisted = asset.delisted,
                    allCashFlowsBrl = allCashFlowsBrl,
                )
            )
        }

        return positions
    }

    fun aggregatePositions(positions: List<AssetPosition>): PortfolioSummary {
        val totalInvested = positions.sumOf { it.totalCostBrl }
        val realizedPnl = positions.sumOf { it.realizedPnlBrl }
        val valuesBrl = positions.mapNotNull { it.currentValueBrl }
        val currentValue = if (valuesBrl.isNotEmpty()) valuesBrl.sum() else null
        val unrealizedBrl = positions.mapNotNull { it.unrealizedPnlBrl }
        val unrealizedPnl = if (unrealizedBrl.isNotEmpty()) unrealizedBrl.sum() else null
        val dividendPnl = positions.sumOf { it.dividendPnl }

        val allCashFlowsBrl = positions.flatMap { it.allCashFlowsBrl }.sortedBy { it.first }
        val irrAnnual = calculationService.calculateXirr(allCashFlowsBrl, currentValue)
        val irrMonthly = irrAnnual?.let { Math.pow(1 + it, 1.0 / 12.0) - 1 }

        return PortfolioSummary(
            totalInvested = totalInvested,
            currentValue = currentValue,
            realizedPnl = realizedPnl,
            unrealizedPnl = unrealizedPnl,
            dividendPnl = dividendPnl,
            irrAnnual = irrAnnual,
            irrMonthly = irrMonthly,
            positions = positions,
        )
    }
}
