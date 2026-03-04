package com.stocks.controller

import com.stocks.dto.AssetPosition
import com.stocks.dto.PortfolioSummary
import com.stocks.model.AssetEntity
import com.stocks.service.PortfolioService
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

@Controller
@RequestMapping("/portfolio")
class PortfolioController(
    private val portfolioService: PortfolioService,
) {
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

        model.addAttribute("positions", positions)
        model.addAttribute("totalInvested", summary.totalInvested)
        model.addAttribute("realizedPnl", summary.realizedPnl)
        model.addAttribute("currentValue", summary.currentValue)
        model.addAttribute("unrealizedPnl", summary.unrealizedPnl)

        val usdRate = positions.firstOrNull { it.currency == "USD" && it.exchangeRate != null }?.exchangeRate
        val hasUsd = positions.any { it.currency == "USD" }
        model.addAttribute("hasUsd", hasUsd)
        model.addAttribute("usdRate", usdRate)

        return "dashboard"
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
