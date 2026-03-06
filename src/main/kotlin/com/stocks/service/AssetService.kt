package com.stocks.service

import com.stocks.dto.AssetRequest
import com.stocks.dto.AssetResponse
import com.stocks.dto.toResponse
import com.stocks.model.AssetEntity
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException

@Service
class AssetService {
    fun findAll(): List<AssetResponse> =
        transaction {
            AssetEntity.all().sortedBy { it.ticker.value }.map { it.toResponse() }
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
        currency: String?
    ): AssetResponse =
        transaction {
            val asset =
                AssetEntity.findById(ticker.uppercase())
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")

            asset.name = name?.ifBlank { null }
            asset.type = type?.ifBlank { "STOCK" }
            asset.yfTicker = yfTicker?.ifBlank { null }
            asset.currency = currency?.ifBlank { "BRL" } ?: asset.currency

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
