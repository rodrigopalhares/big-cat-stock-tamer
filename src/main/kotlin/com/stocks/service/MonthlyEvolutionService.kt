package com.stocks.service

import com.stocks.dto.MonthlyEvolutionRow
import com.stocks.dto.MonthlyEvolutionSummary
import com.stocks.dto.MonthlySnapshotResponse
import com.stocks.model.*
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.lessEq
import org.jetbrains.exposed.v1.jdbc.deleteAll
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.YearMonth

@Service
class MonthlyEvolutionService(
    private val calculationService: CalculationService,
    private val priceHistoryService: PriceHistoryService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    internal fun generateMonthRange(
        start: YearMonth,
        end: YearMonth
    ): List<YearMonth> {
        val months = mutableListOf<YearMonth>()
        var current = start
        while (current <= end) {
            months.add(current)
            current = current.plusMonths(1)
        }
        return months
    }

    internal fun computePositionAtDate(
        transactions: List<TransactionData>,
        date: LocalDate
    ): PositionCalcResult {
        val filtered = transactions.filter { it.date <= date }
        return calculationService.calculatePosition(filtered)
    }

    internal fun findFirstTransactionMonth(): YearMonth? =
        transaction {
            val minDate =
                TransactionEntity
                    .all()
                    .orderBy(Transactions.date to SortOrder.ASC)
                    .limit(1)
                    .firstOrNull()
                    ?.date
            minDate?.let { YearMonth.from(it) }
        }

    internal fun getMonthEndPrice(
        ticker: String,
        monthEnd: LocalDate
    ): Double? =
        transaction {
            PriceHistories
                .select(PriceHistories.close)
                .where {
                    (PriceHistories.assetId eq ticker) and
                        (PriceHistories.date lessEq monthEnd)
                }.orderBy(PriceHistories.date, SortOrder.DESC)
                .limit(1)
                .firstOrNull()
                ?.get(PriceHistories.close)
        }

    fun recalculate() {
        priceHistoryService.runBackfill()

        transaction {
            MonthlySnapshots.deleteAll()
        }

        val firstMonth = findFirstTransactionMonth() ?: return
        val months = generateMonthRange(firstMonth, YearMonth.now())

        val assetTransactions =
            transaction {
                val assets = AssetEntity.all().toList()
                assets
                    .associate { asset ->
                        val txs =
                            asset.transactions.toList().map { tx ->
                                TransactionData(
                                    type = tx.type,
                                    quantity = tx.quantity,
                                    price = tx.price,
                                    fees = tx.fees,
                                    date = tx.date,
                                )
                            }
                        asset.ticker.value to txs
                    }.filter { it.value.isNotEmpty() }
            }

        val assetDividends =
            transaction {
                DividendEntity.all().toList().groupBy(
                    { it.assetId },
                    { it.date to (it.totalAmount - it.taxWithheld) },
                )
            }

        val snapshots = mutableListOf<SnapshotRecord>()

        for ((ticker, txs) in assetTransactions) {
            val dividends = assetDividends[ticker] ?: emptyList()

            for (month in months) {
                val monthEnd = month.atEndOfMonth()
                val position = computePositionAtDate(txs, monthEnd)

                if (position.quantity <= 0) continue

                val marketPrice = getMonthEndPrice(ticker, monthEnd) ?: continue

                val accumulatedDividends = dividends.filter { it.first <= monthEnd }.sumOf { it.second }

                snapshots.add(
                    SnapshotRecord(
                        assetId = ticker,
                        month = month.atDay(1),
                        quantity = position.quantity,
                        avgPrice = position.avgPrice,
                        marketPrice = marketPrice,
                        totalCost = position.totalCost,
                        marketValue = position.quantity * marketPrice,
                        accumulatedNetDividends = accumulatedDividends,
                    ),
                )
            }
        }

        transaction {
            for (record in snapshots) {
                MonthlySnapshotEntity.new {
                    assetId = record.assetId
                    month = record.month
                    quantity = record.quantity
                    avgPrice = record.avgPrice
                    marketPrice = record.marketPrice
                    totalCost = record.totalCost
                    marketValue = record.marketValue
                    accumulatedNetDividends = record.accumulatedNetDividends
                }
            }
        }

        logger.info("Recalculated ${snapshots.size} monthly snapshots")
    }

    fun getEvolution(): MonthlyEvolutionSummary {
        val allSnapshots =
            transaction {
                MonthlySnapshotEntity
                    .all()
                    .orderBy(MonthlySnapshots.month to SortOrder.ASC)
                    .toList()
                    .map { entity ->
                        MonthlySnapshotResponse(
                            assetId = entity.assetId,
                            month = entity.month,
                            quantity = entity.quantity,
                            avgPrice = entity.avgPrice,
                            marketPrice = entity.marketPrice,
                            totalCost = entity.totalCost,
                            marketValue = entity.marketValue,
                            accumulatedNetDividends = entity.accumulatedNetDividends,
                        )
                    }
            }

        if (allSnapshots.isEmpty()) {
            return MonthlyEvolutionSummary(months = emptyList(), tickers = emptyList())
        }

        val allDividends =
            transaction {
                DividendEntity.all().toList().map { it.date to (it.totalAmount - it.taxWithheld) }
            }

        val tickers = allSnapshots.map { it.assetId }.distinct().sorted()
        val grouped = allSnapshots.groupBy { it.month }

        val firstMonth = YearMonth.from(allSnapshots.first().month)
        val lastMonth = YearMonth.from(allSnapshots.last().month)
        val allMonths = generateMonthRange(firstMonth, lastMonth)

        val emptyRow = { month: LocalDate ->
            val monthEnd = YearMonth.from(month).atEndOfMonth()
            val totalDividends = allDividends.filter { it.first <= monthEnd }.sumOf { it.second }
            MonthlyEvolutionRow(
                month = month,
                snapshots = emptyList(),
                totalInvested = 0.0,
                totalMarketValue = 0.0,
                totalAccumulatedNetDividends = totalDividends,
            )
        }

        val months =
            allMonths.map { ym ->
                val monthDate = ym.atDay(1)
                val monthEnd = ym.atEndOfMonth()
                val snapshots = grouped[monthDate]
                val totalDividends = allDividends.filter { it.first <= monthEnd }.sumOf { it.second }
                if (snapshots != null) {
                    MonthlyEvolutionRow(
                        month = monthDate,
                        snapshots = snapshots,
                        totalInvested = snapshots.sumOf { it.totalCost },
                        totalMarketValue = snapshots.sumOf { it.marketValue },
                        totalAccumulatedNetDividends = totalDividends,
                    )
                } else {
                    emptyRow(monthDate)
                }
            }

        return MonthlyEvolutionSummary(months = months, tickers = tickers)
    }
}

private data class SnapshotRecord(
    val assetId: String,
    val month: LocalDate,
    val quantity: Double,
    val avgPrice: Double,
    val marketPrice: Double,
    val totalCost: Double,
    val marketValue: Double,
    val accumulatedNetDividends: Double,
)
