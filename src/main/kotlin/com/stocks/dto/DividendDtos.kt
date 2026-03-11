package com.stocks.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Positive
import java.time.LocalDate
import java.time.LocalDateTime

data class DividendRequest(
    @field:NotBlank
    val assetId: String,
    @field:NotBlank
    val type: String,
    val date: LocalDate,
    @field:Positive
    val totalAmount: Double,
    val taxWithheld: Double = 0.0,
    val broker: String? = null,
    val currency: String? = "BRL",
    val notes: String? = null,
) {
    fun validate() {
        val normalizedType = type.uppercase().trim()
        if (normalizedType !in DIVIDEND_TYPES) {
            throw IllegalArgumentException("type must be one of $DIVIDEND_TYPES")
        }
    }
}

data class DividendResponse(
    val id: Int,
    val assetId: String,
    val type: String,
    val date: LocalDate,
    val totalAmount: Double,
    val taxWithheld: Double,
    val netAmount: Double,
    val totalAmountBrl: Double = totalAmount,
    val taxWithheldBrl: Double = taxWithheld,
    val netAmountBrl: Double = totalAmountBrl - taxWithheldBrl,
    val broker: String?,
    val currency: String?,
    val notes: String?,
    val createdAt: LocalDateTime,
)
