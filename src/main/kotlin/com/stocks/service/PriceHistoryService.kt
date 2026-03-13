package com.stocks.service

import com.stocks.dto.NO_QUOTE_TYPES
import com.stocks.model.*
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.jdbc.*
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.LocalDate

// Resolves Yahoo Finance ticker from asset ticker
fun resolveYfTicker(
    ticker: String,
    yfTicker: String?
): String = yfTicker ?: classifyTicker(ticker).yfCandidates.first()

// Data class for asset categorization input
data class AssetTickerInfo(
    val ticker: String,
    val yfTicker: String?,
    val type: String?,
    val delisted: Boolean = false,
)

// Result of categorization
data class TickerMaps(
    val yfTickerMap: Map<String, String>, // yfTicker -> assetTicker
    val tdTickerMap: Map<String, String>, // yfTicker -> assetTicker
)

// Categorizes assets into Yahoo Finance vs Tesouro Direto maps
fun categorizeAssets(assets: List<AssetTickerInfo>): TickerMaps {
    val yfTickerMap = mutableMapOf<String, String>()
    val tdTickerMap = mutableMapOf<String, String>()

    for (asset in assets) {
        if (asset.delisted) continue
        if (asset.type in NO_QUOTE_TYPES) continue
        if (asset.type == "TESOURO_DIRETO") {
            if (asset.yfTicker != null) {
                tdTickerMap[asset.yfTicker] = asset.ticker
            }
        } else {
            val resolved = resolveYfTicker(asset.ticker, asset.yfTicker)
            yfTickerMap[resolved] = asset.ticker
        }
    }

    return TickerMaps(yfTickerMap, tdTickerMap)
}

// Filters batch API results into PriceRecords
fun filterBatchToRecords(
    batch: Map<String, List<Pair<LocalDate, Double>>>,
    tickerResolver: (String) -> String? = { it },
    datePredicate: (String, LocalDate) -> Boolean,
): List<PriceRecord> {
    val records = mutableListOf<PriceRecord>()
    for ((key, prices) in batch) {
        val assetTicker = tickerResolver(key) ?: continue
        for ((date, close) in prices) {
            if (datePredicate(assetTicker, date)) {
                records.add(PriceRecord(assetTicker, date, close))
            }
        }
    }
    return records
}

@Service
class PriceHistoryService(
    private val quoteService: QuoteService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun getLatestPrice(assetTicker: String): Double? =
        transaction {
            PriceHistories
                .select(PriceHistories.close)
                .where { PriceHistories.assetId eq assetTicker }
                .orderBy(PriceHistories.date, SortOrder.DESC)
                .limit(1)
                .firstOrNull()
                ?.get(PriceHistories.close)
        }

    fun getPricesForDate(
        assetTickers: List<String>,
        date: LocalDate
    ): Map<String, Double> =
        transaction {
            PriceHistories
                .select(PriceHistories.assetId, PriceHistories.close)
                .where {
                    (PriceHistories.assetId inList assetTickers) and
                        (PriceHistories.date eq date)
                }.associate { it[PriceHistories.assetId] to it[PriceHistories.close] }
        }

    fun getLastStoredDate(assetTicker: String): LocalDate? =
        transaction {
            PriceHistories
                .select(PriceHistories.date)
                .where { PriceHistories.assetId eq assetTicker }
                .orderBy(PriceHistories.date, SortOrder.DESC)
                .limit(1)
                .firstOrNull()
                ?.get(PriceHistories.date)
        }

    fun upsertPrices(records: List<PriceRecord>) {
        if (records.isEmpty()) return
        transaction {
            for (record in records) {
                val existing =
                    PriceHistories
                        .selectAll()
                        .where {
                            (PriceHistories.assetId eq record.assetId) and
                                (PriceHistories.date eq record.date)
                        }.firstOrNull()

                if (existing != null) {
                    PriceHistories.update({
                        (PriceHistories.assetId eq record.assetId) and
                            (PriceHistories.date eq record.date)
                    }) {
                        it[close] = record.close
                    }
                } else {
                    PriceHistories.insert {
                        it[assetId] = record.assetId
                        it[date] = record.date
                        it[close] = record.close
                    }
                }
            }
        }
    }

    fun generateDelistedPrices(assetTicker: String) {
        val txPrices =
            transaction {
                TransactionEntity
                    .find { Transactions.assetId eq assetTicker }
                    .toList()
                    .sortedBy { it.date }
                    .map { it.date to it.price }
            }
        if (txPrices.isEmpty()) return

        val today = LocalDate.now()
        val records = mutableListOf<PriceRecord>()

        if (txPrices.size == 1) {
            val (startDate, price) = txPrices.first()
            var d = startDate
            while (!d.isAfter(today)) {
                records.add(PriceRecord(assetTicker, d, price))
                d = d.plusDays(1)
            }
        } else {
            for (i in 0 until txPrices.size - 1) {
                val (dateA, priceA) = txPrices[i]
                val (dateB, priceB) = txPrices[i + 1]
                val totalDays =
                    java.time.temporal.ChronoUnit.DAYS
                        .between(dateA, dateB)
                var d = dateA
                while (d.isBefore(dateB)) {
                    val dayOffset =
                        java.time.temporal.ChronoUnit.DAYS
                            .between(dateA, d)
                    val price =
                        if (totalDays > 0) {
                            priceA + (priceB - priceA) * dayOffset.toDouble() / totalDays.toDouble()
                        } else {
                            priceA
                        }
                    records.add(PriceRecord(assetTicker, d, price))
                    d = d.plusDays(1)
                }
            }
            val lastPrice = txPrices.last().second
            var d = txPrices.last().first
            while (!d.isAfter(today)) {
                records.add(PriceRecord(assetTicker, d, lastPrice))
                d = d.plusDays(1)
            }
        }

        upsertPrices(records)
        logger.debug("Generated ${records.size} delisted prices for $assetTicker")
    }

    fun runBackfill() {
        transaction {
            val assets = AssetEntity.all().toList()
            val today = LocalDate.now()
            val startDates = mutableMapOf<String, LocalDate>()

            // Process delisted assets separately
            val delistedAssets = assets.filter { it.delisted && !it.transactions.empty() }
            for (asset in delistedAssets) {
                generateDelistedPrices(asset.ticker.value)
            }

            val assetInfoList =
                assets.mapNotNull { asset ->
                    val ticker = asset.ticker.value
                    val firstTx = asset.transactions.toList().minOfOrNull { it.date } ?: return@mapNotNull null
                    val lastStored = getLastStoredDate(ticker)
                    val fiveYearsAgo = today.minusYears(5)
                    val start = if (lastStored != null) lastStored.plusDays(1) else minOf(firstTx, fiveYearsAgo)
                    if (start > today) return@mapNotNull null
                    startDates[ticker] = start
                    AssetTickerInfo(ticker, asset.yfTicker, asset.type, asset.delisted)
                }

            val maps = categorizeAssets(assetInfoList)

            // yfinance batch
            if (maps.yfTickerMap.isNotEmpty()) {
                try {
                    val earliest =
                        maps.yfTickerMap.values
                            .mapNotNull { startDates[it] }
                            .minOrNull() ?: today
                    val batch = quoteService.fetchHistoricalQuotesBatch(maps.yfTickerMap, earliest)
                    val records =
                        filterBatchToRecords(batch) { ticker, date ->
                            date >= (startDates[ticker] ?: earliest)
                        }
                    upsertPrices(records)
                    logger.info("Backfilled ${records.size} yfinance records for ${maps.yfTickerMap.size} assets")
                } catch (e: Exception) {
                    logger.error("Error in yfinance backfill batch: ${e.message}")
                }
            }

            // Tesouro Direto batch
            if (maps.tdTickerMap.isNotEmpty()) {
                try {
                    val batch = quoteService.fetchTdHistoricalQuotesBatch(maps.tdTickerMap.keys.toList())
                    val records =
                        filterBatchToRecords(batch, { maps.tdTickerMap[it] }) { ticker, date ->
                            date >= (startDates[ticker] ?: LocalDate.MIN)
                        }
                    upsertPrices(records)
                    logger.info("Backfilled ${records.size} TD records for ${maps.tdTickerMap.size} assets")
                } catch (e: Exception) {
                    logger.error("Error in TD backfill batch: ${e.message}")
                }
            }
        }
    }

    fun runDailyUpdate() {
        transaction {
            val assets = AssetEntity.all().toList()
            val today = LocalDate.now()

            // Process delisted assets separately
            val delistedAssets = assets.filter { it.delisted && !it.transactions.empty() }
            for (asset in delistedAssets) {
                generateDelistedPrices(asset.ticker.value)
            }

            val assetInfoList =
                assets
                    .filter { !it.transactions.empty() }
                    .map { AssetTickerInfo(it.ticker.value, it.yfTicker, it.type, it.delisted) }

            val maps = categorizeAssets(assetInfoList)

            if (maps.yfTickerMap.isNotEmpty()) {
                try {
                    val batch = quoteService.fetchHistoricalQuotesBatch(maps.yfTickerMap, today)
                    val records =
                        filterBatchToRecords(batch) { _, date -> date == today }
                    upsertPrices(records)
                    logger.info("Daily update: stored ${records.size} yfinance prices")
                } catch (e: Exception) {
                    logger.error("Error in daily yfinance update: ${e.message}")
                }
            }

            if (maps.tdTickerMap.isNotEmpty()) {
                try {
                    val batch = quoteService.fetchTdHistoricalQuotesBatch(maps.tdTickerMap.keys.toList())
                    val records =
                        filterBatchToRecords(batch, { maps.tdTickerMap[it] }) { _, date -> date == today }
                    upsertPrices(records)
                    logger.info("Daily update: stored ${records.size} TD prices")
                } catch (e: Exception) {
                    logger.error("Error in daily TD update: ${e.message}")
                }
            }
        }
    }
}

data class PriceRecord(
    val assetId: String,
    val date: LocalDate,
    val close: Double,
)
