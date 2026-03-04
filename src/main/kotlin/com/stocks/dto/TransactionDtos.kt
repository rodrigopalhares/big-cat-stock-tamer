package com.stocks.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Positive
import java.time.LocalDate
import java.time.LocalDateTime

data class TransactionRequest(
    @field:NotBlank
    val assetId: String,
    @field:NotBlank
    val type: String,
    @field:Positive
    val quantity: Double,
    @field:Positive
    val price: Double,
    val fees: Double = 0.0,
    val date: LocalDate,
    val broker: String? = null,
    val notes: String? = null,
) {
    fun validate() {
        val normalizedType = type.uppercase().trim()
        if (normalizedType !in listOf("BUY", "SELL")) {
            throw IllegalArgumentException("type must be BUY or SELL")
        }
    }
}

data class TransactionResponse(
    val id: Int,
    val assetId: String,
    val type: String,
    val quantity: Double,
    val price: Double,
    val fees: Double,
    val date: LocalDate,
    val broker: String?,
    val notes: String?,
    val createdAt: LocalDateTime,
)
