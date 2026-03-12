package com.stocks.controller

import com.stocks.dto.AssetPosition
import com.stocks.dto.PortfolioSummary
import com.stocks.model.AssetEntity
import com.stocks.service.MonthlyEvolutionService
import com.stocks.service.PortfolioService
import com.stocks.service.PriceHistoryService
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.ObjectMapper
import java.time.format.DateTimeFormatter

@Controller
@RequestMapping("/portfolio")
class PortfolioController(
    private val portfolioService: PortfolioService,
    private val monthlyEvolutionService: MonthlyEvolutionService,
    private val priceHistoryService: PriceHistoryService,
    private val objectMapper: ObjectMapper,
) {
    private val monthFormatter = DateTimeFormatter.ofPattern("MM/yyyy")

    // --- HTML Routes ---

    @GetMapping("/")
    fun dashboard(model: Model): String {
        val (positions, summary) =
            transaction {
                val assets = AssetEntity.all().toList()
                // Eagerly load transactions
                assets.forEach { it.transactions.toList() }

                val positions = portfolioService.buildPositions(assets, fetchQuotes = true)
                val summary = portfolioService.aggregatePositions(positions)
                positions to summary
            }

        val sortedPositions = positions.sortedWith(compareBy({ it.type ?: "" }, { it.ticker }))
        model.addAttribute("positions", sortedPositions)
        model.addAttribute("assetTypes", positions.mapNotNull { it.type }.distinct().sorted())
        model.addAttribute("totalInvested", summary.totalInvested)
        model.addAttribute("realizedPnl", summary.realizedPnl)
        model.addAttribute("currentValue", summary.currentValue)
        model.addAttribute("unrealizedPnl", summary.unrealizedPnl)
        model.addAttribute("dividendPnl", summary.dividendPnl)
        model.addAttribute("irrAnnual", summary.irrAnnual)
        model.addAttribute("irrMonthly", summary.irrMonthly)

        val usdRate = positions.firstOrNull { it.currency == "USD" && it.exchangeRate != null }?.exchangeRate
        val hasUsd = positions.any { it.currency == "USD" }
        model.addAttribute("hasUsd", hasUsd)
        model.addAttribute("usdRate", usdRate)

        // Evolution chart data grouped by asset type
        val evolution = monthlyEvolutionService.getEvolution()
        val assetTypeMap =
            transaction {
                AssetEntity.all().toList().associate { it.ticker.value to (it.type ?: "STOCK") }
            }

        val chartLabels = evolution.months.map { it.month.format(monthFormatter) }
        val assetTypes = assetTypeMap.values.distinct().sorted()

        val chartDatasets =
            assetTypes.map { type ->
                val tickersOfType = assetTypeMap.filterValues { it == type }.keys
                val data =
                    evolution.months.map { row ->
                        row.snapshots
                            .filter { it.assetId in tickersOfType }
                            .sumOf { it.marketValue }
                    }
                mapOf("label" to type, "data" to data)
            }

        val investedLine = evolution.months.map { it.totalInvested }

        model.addAttribute("chartLabels", objectMapper.writeValueAsString(chartLabels))
        model.addAttribute("chartDatasets", objectMapper.writeValueAsString(chartDatasets))
        model.addAttribute("chartInvestedLine", objectMapper.writeValueAsString(investedLine))
        model.addAttribute("hasEvolutionData", evolution.months.isNotEmpty())

        return "dashboard"
    }

    @PostMapping("/update-prices")
    @ResponseBody
    fun updatePrices(): String {
        priceHistoryService.runDailyUpdate()
        return ""
    }

    // --- JSON API Routes ---

    @GetMapping("/api")
    @ResponseBody
    fun portfolioSummary(): PortfolioSummary =
        transaction {
            val assets = AssetEntity.all().toList()
            assets.forEach { it.transactions.toList() }

            val positions = portfolioService.buildPositions(assets, fetchQuotes = true)
            portfolioService.aggregatePositions(positions)
        }

    @GetMapping("/api/{ticker}")
    @ResponseBody
    fun assetPosition(
        @PathVariable ticker: String
    ): AssetPosition =
        transaction {
            val asset =
                AssetEntity.findById(ticker.uppercase())
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")
            asset.transactions.toList()

            val positions = portfolioService.buildPositions(listOf(asset), fetchQuotes = true)
            if (positions.isEmpty()) {
                throw ResponseStatusException(HttpStatus.NOT_FOUND, "No transactions found for this asset")
            }
            positions[0]
        }
}
