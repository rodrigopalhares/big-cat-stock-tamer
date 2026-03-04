package com.stocks.service

import com.stocks.model.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.transactions.transaction
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.LocalDate

@Service
class PriceHistoryService(
    private val quoteService: QuoteService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun getLatestPrice(assetTicker: String): Double? {
        return transaction {
            PriceHistories
                .select(PriceHistories.close)
                .where { PriceHistories.assetId eq assetTicker }
                .orderBy(PriceHistories.date, SortOrder.DESC)
                .limit(1)
                .firstOrNull()
                ?.get(PriceHistories.close)
        }
    }

    fun getLastStoredDate(assetTicker: String): LocalDate? {
        return transaction {
            PriceHistories
                .select(PriceHistories.date)
                .where { PriceHistories.assetId eq assetTicker }
                .orderBy(PriceHistories.date, SortOrder.DESC)
                .limit(1)
                .firstOrNull()
                ?.get(PriceHistories.date)
        }
    }

    fun upsertPrices(records: List<PriceRecord>) {
        if (records.isEmpty()) return
        transaction {
            for (record in records) {
                val existing = PriceHistories
                    .selectAll()
                    .where {
                        (PriceHistories.assetId eq record.assetId) and
                        (PriceHistories.date eq record.date)
                    }
                    .firstOrNull()

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

    fun runBackfill() {
        transaction {
            val assets = AssetEntity.all().toList()
            val assetData = assets.map { asset ->
                AssetBackfillData(
                    ticker = asset.ticker.value,
                    yfTicker = asset.yfTicker,
                    type = asset.type,
                    firstTransactionDate = asset.transactions.toList()
                        .minOfOrNull { it.date },
                )
            }

            val today = LocalDate.now()
            val yfTickerMap = mutableMapOf<String, String>()
            val tdTickerMap = mutableMapOf<String, String>()
            val startDates = mutableMapOf<String, LocalDate>()

            for (data in assetData) {
                val firstTx = data.firstTransactionDate ?: continue
                val lastStored = getLastStoredDate(data.ticker)
                val start = if (lastStored != null) lastStored.plusDays(1) else firstTx
                if (start > today) continue

                startDates[data.ticker] = start

                if (data.type == "TESOURO_DIRETO") {
                    if (data.yfTicker != null) {
                        tdTickerMap[data.yfTicker] = data.ticker
                    }
                } else {
                    val yfTicker = data.yfTicker
                        ?: if ("." !in data.ticker) "${data.ticker}.SA" else data.ticker
                    yfTickerMap[yfTicker] = data.ticker
                }
            }

            // yfinance batch
            if (yfTickerMap.isNotEmpty()) {
                try {
                    val earliest = yfTickerMap.values
                        .mapNotNull { startDates[it] }
                        .minOrNull() ?: today

                    val batch = quoteService.fetchHistoricalQuotesBatch(yfTickerMap, earliest)
                    val records = mutableListOf<PriceRecord>()
                    for ((assetTicker, prices) in batch) {
                        val cutoff = startDates[assetTicker] ?: earliest
                        for ((date, close) in prices) {
                            if (date >= cutoff) {
                                records.add(PriceRecord(assetTicker, date, close))
                            }
                        }
                    }
                    upsertPrices(records)
                    logger.info("Backfilled ${records.size} yfinance records for ${yfTickerMap.size} assets")
                } catch (e: Exception) {
                    logger.error("Error in yfinance backfill batch: ${e.message}")
                }
            }

            // Tesouro Direto batch
            if (tdTickerMap.isNotEmpty()) {
                try {
                    val batch = quoteService.fetchTdHistoricalQuotesBatch(tdTickerMap.keys.toList())
                    val records = mutableListOf<PriceRecord>()
                    for ((yfTicker, prices) in batch) {
                        val assetTicker = tdTickerMap[yfTicker] ?: continue
                        val cutoff = startDates[assetTicker] ?: LocalDate.MIN
                        for ((date, close) in prices) {
                            if (date >= cutoff) {
                                records.add(PriceRecord(assetTicker, date, close))
                            }
                        }
                    }
                    upsertPrices(records)
                    logger.info("Backfilled ${records.size} TD records for ${tdTickerMap.size} assets")
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

            val yfTickerMap = mutableMapOf<String, String>()
            val tdTickerMap = mutableMapOf<String, String>()

            for (asset in assets) {
                if (asset.transactions.empty()) continue
                val ticker = asset.ticker.value

                if (asset.type == "TESOURO_DIRETO") {
                    if (asset.yfTicker != null) {
                        tdTickerMap[asset.yfTicker!!] = ticker
                    }
                } else {
                    val yfTicker = asset.yfTicker
                        ?: if ("." !in ticker) "${ticker}.SA" else ticker
                    yfTickerMap[yfTicker] = ticker
                }
            }

            if (yfTickerMap.isNotEmpty()) {
                try {
                    val batch = quoteService.fetchHistoricalQuotesBatch(yfTickerMap, today)
                    val records = batch.flatMap { (assetTicker, prices) ->
                        prices.filter { it.first == today }
                            .map { PriceRecord(assetTicker, it.first, it.second) }
                    }
                    upsertPrices(records)
                    logger.info("Daily update: stored ${records.size} yfinance prices")
                } catch (e: Exception) {
                    logger.error("Error in daily yfinance update: ${e.message}")
                }
            }

            if (tdTickerMap.isNotEmpty()) {
                try {
                    val batch = quoteService.fetchTdHistoricalQuotesBatch(tdTickerMap.keys.toList())
                    val records = mutableListOf<PriceRecord>()
                    for ((yfTicker, prices) in batch) {
                        val assetTicker = tdTickerMap[yfTicker] ?: continue
                        for ((date, close) in prices) {
                            if (date == today) {
                                records.add(PriceRecord(assetTicker, date, close))
                            }
                        }
                    }
                    upsertPrices(records)
                    logger.info("Daily update: stored ${records.size} TD prices")
                } catch (e: Exception) {
                    logger.error("Error in daily TD update: ${e.message}")
                }
            }
        }
    }

    private data class AssetBackfillData(
        val ticker: String,
        val yfTicker: String?,
        val type: String?,
        val firstTransactionDate: LocalDate?,
    )
}

data class PriceRecord(
    val assetId: String,
    val date: LocalDate,
    val close: Double,
)
