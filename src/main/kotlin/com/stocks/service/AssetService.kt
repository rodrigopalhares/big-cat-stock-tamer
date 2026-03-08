package com.stocks.service

import com.stocks.dto.AssetRequest
import com.stocks.dto.AssetResponse
import com.stocks.dto.toResponse
import com.stocks.model.AssetEntity
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
                val tickersWithPosition = computeTickersWithPosition()
                assets =
                    when (position) {
                        "with" -> assets.filter { it.ticker.value in tickersWithPosition }
                        "without" -> assets.filter { it.ticker.value !in tickersWithPosition }
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

    fun computeTickersWithPosition(): Set<String> {
        val allTransactions =
            com.stocks.model.TransactionEntity
                .all()
                .toList()
                .groupBy { it.assetId }

        return allTransactions
            .filter { (_, txs) ->
                val data =
                    txs.map {
                        TransactionData(
                            type = it.type,
                            quantity = it.quantity,
                            price = it.price,
                            fees = it.fees,
                            date = it.date,
                        )
                    }
                calculationService.calculatePosition(data).quantity > 0
            }.keys
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
}
