package com.stocks.service

import com.stocks.model.BenchmarkPriceEntity
import com.stocks.model.BenchmarkPrices
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.upsert
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import org.springframework.web.client.body
import java.time.LocalDate
import java.time.YearMonth

@Service
class BenchmarkService(
    private val quoteService: QuoteService,
    private val restClient: RestClient,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    companion object {
        const val IBOV_YF_TICKER = "^BVSP"
        const val IBOV_TICKER = "IBOV"
        private const val BCB_CDI_SERIES = "4391" // Selic meta (proxy for CDI annual rate)
    }

    fun fetchAndStoreIbovMonthly() {
        val startDate = LocalDate.now().minusYears(5).withDayOfMonth(1)
        val prices =
            quoteService.fetchHistoricalQuotesBatch(
                mapOf(IBOV_YF_TICKER to IBOV_TICKER),
                startDate,
            )

        val dailyPrices =
            prices[IBOV_TICKER] ?: run {
                logger.warn("No IBOV historical data returned from Yahoo Finance")
                return
            }

        // Group by month and take the last available price of each month
        val monthlyPrices =
            dailyPrices
                .groupBy { YearMonth.from(it.first) }
                .mapValues { (_, entries) -> entries.maxByOrNull { it.first }!! }

        transaction {
            for ((yearMonth, entry) in monthlyPrices) {
                val monthDate = yearMonth.atDay(1)
                BenchmarkPrices.upsert(BenchmarkPrices.ticker, BenchmarkPrices.month) {
                    it[ticker] = IBOV_TICKER
                    it[month] = monthDate
                    it[close] = entry.second
                }
            }
        }

        logger.info("Stored ${monthlyPrices.size} monthly IBOV prices")
    }

    fun getMonthlyPrices(ticker: String = IBOV_TICKER): List<Pair<LocalDate, Double>> =
        transaction {
            BenchmarkPriceEntity
                .find { BenchmarkPrices.ticker eq ticker }
                .orderBy(BenchmarkPrices.month to SortOrder.ASC)
                .map { it.month to it.close }
        }

    fun getMonthlyPricesMap(ticker: String = IBOV_TICKER): Map<LocalDate, Double> = getMonthlyPrices(ticker).toMap()

    fun hasData(ticker: String = IBOV_TICKER): Boolean =
        transaction {
            BenchmarkPriceEntity
                .find { BenchmarkPrices.ticker eq ticker }
                .limit(1)
                .firstOrNull() != null
        }

    fun fetchCdiAnnualRate(): Double? {
        val url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.$BCB_CDI_SERIES/dados/ultimos/1?formato=json"
        logger.info("Fetching CDI rate: $url")

        return try {
            val response =
                restClient
                    .get()
                    .uri(url)
                    .retrieve()
                    .body<List<BcbSeriesEntry>>() ?: return null

            val entry = response.firstOrNull() ?: return null
            val rate = entry.valor.replace(",", ".").toDoubleOrNull()
            rate?.let { it / 100.0 } // Convert from percentage (e.g. 14.25 -> 0.1425)
        } catch (e: Exception) {
            logger.error("Error fetching CDI rate from BCB: ${e.message}")
            null
        }
    }

    fun clearBenchmarkData(ticker: String = IBOV_TICKER) {
        transaction {
            BenchmarkPriceEntity
                .find { BenchmarkPrices.ticker eq ticker }
                .forEach { it.delete() }
        }
    }
}

private data class BcbSeriesEntry(
    val data: String = "",
    val valor: String = "",
)
