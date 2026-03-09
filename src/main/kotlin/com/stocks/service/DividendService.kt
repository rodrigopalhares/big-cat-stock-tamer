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
        return transaction {
            transactionService.findOrCreateAsset(normalized)
            DividendEntity.new {
                assetId = normalized
                this.type = type.uppercase().trim()
                this.date = date
                this.totalAmount = totalAmount
                this.taxWithheld = taxWithheld
                this.broker = broker?.ifBlank { null }
                this.currency = currency.ifBlank { "BRL" }
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
        transaction {
            val dividend =
                DividendEntity.findById(id)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Dividend not found")
            dividend.type = type.uppercase().trim()
            dividend.date = date
            dividend.totalAmount = totalAmount
            dividend.taxWithheld = taxWithheld
            dividend.broker = broker?.ifBlank { null }
            dividend.currency = currency.ifBlank { "BRL" }
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
                dividends.sumOf { it.totalAmount - it.taxWithheld }
            }
        }

    fun getDividendCashFlowsByAsset(): Map<String, List<Pair<LocalDate, Double>>> =
        transaction {
            DividendEntity.all().toList().groupBy { it.assetId }.mapValues { (_, dividends) ->
                dividends.map { it.date to (it.totalAmount - it.taxWithheld) }
            }
        }
}
