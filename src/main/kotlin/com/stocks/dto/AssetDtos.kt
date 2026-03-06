package com.stocks.dto

import com.stocks.model.AssetEntity
import jakarta.validation.constraints.NotBlank
import java.time.LocalDateTime

data class AssetRequest(
    @field:NotBlank
    val ticker: String,
    val yfTicker: String? = null,
    val name: String? = null,
    val type: String? = "STOCK",
    val currency: String = "BRL",
) {
    fun normalizedTicker(): String = ticker.uppercase().trim()

    fun validate() {
        val t = type
        if (t != null && t !in ASSET_TYPES) {
            throw IllegalArgumentException("type must be one of ${ASSET_TYPES.joinToString(", ")}")
        }
    }
}

data class AssetResponse(
    val ticker: String,
    val yfTicker: String?,
    val name: String?,
    val type: String?,
    val currency: String,
    val createdAt: LocalDateTime,
)

data class AssetInfo(
    val name: String,
    val type: String,
    val yfTicker: String,
    val currency: String = "BRL",
)

fun AssetEntity.toResponse() =
    AssetResponse(
        ticker = ticker.value,
        yfTicker = yfTicker,
        name = name,
        type = type,
        currency = currency,
        createdAt = createdAt,
    )
