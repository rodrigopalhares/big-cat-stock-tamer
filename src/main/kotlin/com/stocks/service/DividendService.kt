package com.stocks.service

import com.stocks.model.DividendEntity
import com.stocks.model.Dividends
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.andWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.time.LocalDate

@Service
class DividendService(
    private val transactionService: TransactionService,
    private val exchangeRateService: ExchangeRateService,
) {
    fun createDividend(
        ticker: String,
        type: String,
        date: LocalDate,
        totalAmount: Double,
        taxWithheld: Double,
        notes: String?,
        broker: String? = null,
        currency: String = "BRL",
    ): DividendEntity {
        val normalized = ticker.uppercase().trim()
        val effectiveCurrency = currency.ifBlank { "BRL" }
        val (amountBrl, taxBrl) = convertToBrl(totalAmount, taxWithheld, effectiveCurrency, date)
        return transaction {
            transactionService.findOrCreateAsset(normalized)
            DividendEntity.new {
                assetId = normalized
                this.type = type.uppercase().trim()
                this.date = date
                this.totalAmount = totalAmount
                this.taxWithheld = taxWithheld
                this.totalAmountBrl = amountBrl
                this.taxWithheldBrl = taxBrl
                this.broker = broker?.ifBlank { null }
                this.currency = effectiveCurrency
                this.notes = notes?.ifBlank { null }
            }
        }
    }

    fun listDividends(
        ticker: String? = null,
        type: String? = null,
    ): List<DividendEntity> =
        transaction {
            val query = Dividends.selectAll()

            if (!ticker.isNullOrBlank()) {
                query.andWhere { Dividends.assetId eq ticker.uppercase() }
            }
            if (!type.isNullOrBlank()) {
                query.andWhere { Dividends.type eq type.uppercase() }
            }

            query.orderBy(Dividends.date, SortOrder.DESC)

            DividendEntity.wrapRows(query).toList()
        }

    fun updateDividend(
        id: Int,
        type: String,
        date: LocalDate,
        totalAmount: Double,
        taxWithheld: Double,
        notes: String?,
        broker: String? = null,
        currency: String = "BRL",
    ) {
        val effectiveCurrency = currency.ifBlank { "BRL" }
        val (amountBrl, taxBrl) = convertToBrl(totalAmount, taxWithheld, effectiveCurrency, date)
        transaction {
            val dividend =
                DividendEntity.findById(id)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Dividend not found")
            dividend.type = type.uppercase().trim()
            dividend.date = date
            dividend.totalAmount = totalAmount
            dividend.taxWithheld = taxWithheld
            dividend.totalAmountBrl = amountBrl
            dividend.taxWithheldBrl = taxBrl
            dividend.broker = broker?.ifBlank { null }
            dividend.currency = effectiveCurrency
            dividend.notes = notes?.ifBlank { null }
        }
    }

    fun deleteDividend(id: Int) {
        transaction {
            val dividend =
                DividendEntity.findById(id)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Dividend not found")
            dividend.delete()
        }
    }

    fun getDividendPnlByAsset(): Map<String, Double> =
        transaction {
            DividendEntity.all().toList().groupBy { it.assetId }.mapValues { (_, dividends) ->
                dividends.sumOf { it.totalAmountBrl - it.taxWithheldBrl }
            }
        }

    fun getDividendCashFlowsByAsset(): Map<String, List<Pair<LocalDate, Double>>> =
        transaction {
            DividendEntity.all().toList().groupBy { it.assetId }.mapValues { (_, dividends) ->
                dividends.map { it.date to (it.totalAmountBrl - it.taxWithheldBrl) }
            }
        }

    private fun convertToBrl(
        totalAmount: Double,
        taxWithheld: Double,
        currency: String,
        date: LocalDate,
    ): Pair<Double, Double> {
        if (currency == "BRL") return totalAmount to taxWithheld
        val rate = exchangeRateService.getRate(currency, "BRL", date)
        return (totalAmount * rate) to (taxWithheld * rate)
    }
}
