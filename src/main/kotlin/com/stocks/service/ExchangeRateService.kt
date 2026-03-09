package com.stocks.service

import com.stocks.model.ExchangeRateEntity
import com.stocks.model.ExchangeRates
import com.stocks.model.Transactions
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.upsert
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.LocalDate

@Service
class ExchangeRateService(
    private val bcbClient: BcbPtaxClient,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun getRate(
        fromCurrency: String,
        toCurrency: String = "BRL",
        date: LocalDate = LocalDate.now(),
    ): Double {
        if (fromCurrency == toCurrency) return 1.0

        val existing = findRate(fromCurrency, toCurrency, date)
        if (existing != null) return existing

        backfillFromBcb(fromCurrency, toCurrency)

        return findRate(fromCurrency, toCurrency, date)
            ?: findClosestRate(fromCurrency, toCurrency, date)
            ?: error("No exchange rate found for $fromCurrency/$toCurrency on $date")
    }

    internal fun findRate(
        fromCurrency: String,
        toCurrency: String,
        date: LocalDate,
    ): Double? =
        transaction {
            ExchangeRateEntity
                .find {
                    (ExchangeRates.date eq date) and
                        (ExchangeRates.fromCurrency eq fromCurrency) and
                        (ExchangeRates.toCurrency eq toCurrency)
                }.firstOrNull()
                ?.sellRate
        }

    internal fun findClosestRate(
        fromCurrency: String,
        toCurrency: String,
        date: LocalDate,
    ): Double? =
        transaction {
            ExchangeRateEntity
                .find {
                    (ExchangeRates.fromCurrency eq fromCurrency) and
                        (ExchangeRates.toCurrency eq toCurrency)
                }.orderBy(ExchangeRates.date to SortOrder.DESC)
                .limit(1)
                .firstOrNull()
                ?.sellRate
        }

    internal fun backfillFromBcb(
        fromCurrency: String,
        toCurrency: String,
    ) {
        val startDate = findOldestTransactionDate() ?: LocalDate.now()
        val endDate = LocalDate.now()

        val quotes = bcbClient.fetchRange(startDate, endDate)
        if (quotes.isEmpty()) {
            logger.warn("BCB returned no quotes for $startDate to $endDate")
            return
        }

        // Fill gaps: for each day in the range, use the most recent quote
        val quotesByDate = quotes.toMap().toSortedMap()
        var lastBuyRate: Double? = null
        var lastSellRate: Double? = null

        var current = startDate
        while (!current.isAfter(endDate)) {
            val quote = quotesByDate[current]
            if (quote != null) {
                lastBuyRate = quote.first
                lastSellRate = quote.second
            }
            if (lastBuyRate != null && lastSellRate != null) {
                upsertRate(current, fromCurrency, toCurrency, lastBuyRate, lastSellRate)
            }
            current = current.plusDays(1)
        }

        logger.info("Backfilled $fromCurrency/$toCurrency exchange rates from $startDate to $endDate")
    }

    internal fun upsertRate(
        date: LocalDate,
        fromCurrency: String,
        toCurrency: String,
        buyRate: Double,
        sellRate: Double,
    ) {
        transaction {
            ExchangeRates.upsert(ExchangeRates.date, ExchangeRates.fromCurrency, ExchangeRates.toCurrency) {
                it[ExchangeRates.date] = date
                it[ExchangeRates.fromCurrency] = fromCurrency
                it[ExchangeRates.toCurrency] = toCurrency
                it[ExchangeRates.buyRate] = buyRate
                it[ExchangeRates.sellRate] = sellRate
            }
        }
    }

    private fun findOldestTransactionDate(): LocalDate? =
        transaction {
            com.stocks.model.TransactionEntity
                .all()
                .orderBy(Transactions.date to SortOrder.ASC)
                .limit(1)
                .firstOrNull()
                ?.date
        }
}
