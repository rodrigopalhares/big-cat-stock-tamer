package com.stocks.service

import com.stocks.dto.AssetRequest
import com.stocks.dto.AssetResponse
import com.stocks.dto.toResponse
import com.stocks.model.AssetEntity
import com.stocks.model.TransactionEntity
import com.stocks.model.Transactions
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException

@Service
class AssetService(
    private val calculationService: CalculationService,
) {
    fun findAll(): List<AssetResponse> =
        transaction {
            AssetEntity.all().sortedBy { it.ticker.value }.map { it.toResponse() }
        }

    fun findFiltered(
        type: String?,
        position: String?,
        delisted: String? = null,
    ): List<AssetResponse> =
        transaction {
            var assets = AssetEntity.all().sortedBy { it.ticker.value }.toList()

            if (!type.isNullOrBlank()) {
                assets = assets.filter { it.type == type }
            }

            if (!position.isNullOrBlank() && position != "all") {
                assets =
                    when (position) {
                        "with" -> assets.filter { it.hasPosition }
                        "without" -> assets.filter { !it.hasPosition }
                        else -> assets
                    }
            }

            if (!delisted.isNullOrBlank()) {
                assets =
                    when (delisted) {
                        "active" -> assets.filter { !it.delisted }
                        "delisted" -> assets.filter { it.delisted }
                        else -> assets
                    }
            }

            assets.map { it.toResponse() }
        }

    fun computeTickersWithPosition(): Set<String> =
        transaction {
            AssetEntity
                .all()
                .toList()
                .filter { it.hasPosition }
                .map { it.ticker.value }
                .toSet()
        }

    fun findById(ticker: String): AssetResponse? =
        transaction {
            AssetEntity.findById(ticker.uppercase())?.toResponse()
        }

    fun create(request: AssetRequest): AssetResponse {
        request.validate()
        val normalizedTicker = request.normalizedTicker()

        return transaction {
            if (AssetEntity.findById(normalizedTicker) != null) {
                throw ResponseStatusException(HttpStatus.CONFLICT, "Ticker already registered")
            }

            AssetEntity
                .new(normalizedTicker) {
                    yfTicker = request.yfTicker
                    name = request.name
                    type = request.type ?: "STOCK"
                    currency = request.currency
                }.toResponse()
        }
    }

    fun update(
        ticker: String,
        name: String?,
        type: String?,
        yfTicker: String?,
        currency: String?,
        delisted: Boolean,
    ): AssetResponse =
        transaction {
            val asset =
                AssetEntity.findById(ticker.uppercase())
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")

            asset.name = name?.ifBlank { null }
            asset.type = type?.ifBlank { "STOCK" }
            asset.yfTicker = yfTicker?.ifBlank { null }
            asset.currency = currency?.ifBlank { "BRL" } ?: asset.currency
            asset.delisted = delisted

            asset.toResponse()
        }

    fun delete(ticker: String) =
        transaction {
            val asset =
                AssetEntity.findById(ticker.uppercase())
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")
            asset.delete()
        }

    fun exists(ticker: String): Boolean =
        transaction {
            AssetEntity.findById(ticker.uppercase()) != null
        }

    fun refreshPositionFields(assetId: String) {
        transaction {
            val asset =
                AssetEntity.findById(assetId.uppercase()) ?: return@transaction

            val txs =
                TransactionEntity
                    .find { Transactions.assetId eq assetId.uppercase() }
                    .toList()

            if (txs.isEmpty()) {
                asset.hasPosition = false
                asset.quantity = 0.0
                asset.avgPrice = 0.0
                asset.avgPriceBrl = 0.0
                asset.totalCost = 0.0
                asset.totalCostBrl = 0.0
                asset.realizedPnl = 0.0
                asset.realizedPnlBrl = 0.0
                return@transaction
            }

            val data =
                txs.map {
                    TransactionData(
                        type = it.type,
                        quantity = it.quantity,
                        price = it.price,
                        fees = it.fees,
                        date = it.date,
                        priceBrl = it.priceBrl,
                        feesBrl = it.feesBrl,
                    )
                }

            val calc = calculationService.calculatePosition(data)
            asset.hasPosition = calc.quantity > 0
            asset.quantity = calc.quantity
            asset.avgPrice = calc.avgPrice
            asset.avgPriceBrl = calc.avgPriceBrl
            asset.totalCost = calc.totalCost
            asset.totalCostBrl = calc.totalCostBrl
            asset.realizedPnl = calc.realizedPnl
            asset.realizedPnlBrl = calc.realizedPnlBrl
        }
    }

    fun refreshAllPositionFields() {
        transaction {
            val assets = AssetEntity.all().toList()
            for (asset in assets) {
                val txs = asset.transactions.toList()

                if (txs.isEmpty()) {
                    asset.hasPosition = false
                    asset.quantity = 0.0
                    asset.avgPrice = 0.0
                    asset.avgPriceBrl = 0.0
                    asset.totalCost = 0.0
                    asset.totalCostBrl = 0.0
                    asset.realizedPnl = 0.0
                    asset.realizedPnlBrl = 0.0
                    continue
                }

                val data =
                    txs.map {
                        TransactionData(
                            type = it.type,
                            quantity = it.quantity,
                            price = it.price,
                            fees = it.fees,
                            date = it.date,
                            priceBrl = it.priceBrl,
                            feesBrl = it.feesBrl,
                        )
                    }

                val calc = calculationService.calculatePosition(data)
                asset.hasPosition = calc.quantity > 0
                asset.quantity = calc.quantity
                asset.avgPrice = calc.avgPrice
                asset.avgPriceBrl = calc.avgPriceBrl
                asset.totalCost = calc.totalCost
                asset.totalCostBrl = calc.totalCostBrl
                asset.realizedPnl = calc.realizedPnl
                asset.realizedPnlBrl = calc.realizedPnlBrl
            }
        }
    }
}
