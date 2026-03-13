package com.stocks.service

import com.stocks.model.*
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.upsert
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.pow

private const val MIN_RELIABLE_DATA_POINTS = 12
private const val LOOKBACK_YEARS = 5L

data class RegressionResult(
    val beta: Double,
    val alpha: Double,
    val rSquared: Double,
    val dataPoints: Int,
)

data class RiskMetricsResult(
    val ticker: String,
    val name: String?,
    val type: String?,
    val beta: Double?,
    val alphaAnnual: Double?,
    val rSquared: Double?,
    val dataPoints: Int,
    val reliable: Boolean,
)

data class RiskMetricsSummary(
    val metrics: List<RiskMetricsResult>,
    val portfolioBeta: Double?,
    val cdiAnnual: Double?,
    val calculatedAt: LocalDate?,
)

@Service
class RiskMetricsService(
    private val benchmarkService: BenchmarkService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun recalculate() {
        benchmarkService.fetchAndStoreIbovMonthly()

        val ibovPrices = benchmarkService.getMonthlyPricesMap()
        if (ibovPrices.size < 2) {
            logger.warn("Not enough IBOV data to compute risk metrics")
            return
        }

        val cdiAnnual = benchmarkService.fetchCdiAnnualRate()
        val rfMonthly = cdiAnnual?.let { (1 + it).pow(1.0 / 12.0) - 1 } ?: 0.0

        val cutoffDate = LocalDate.now().minusYears(LOOKBACK_YEARS).withDayOfMonth(1)

        val ibovReturns = computeMonthlyReturns(ibovPrices, cutoffDate)
        if (ibovReturns.size < 2) {
            logger.warn("Not enough IBOV monthly returns for regression")
            return
        }

        val assets =
            transaction {
                AssetEntity
                    .all()
                    .toList()
                    .filter { it.type in listOf("STOCK", "REIT") }
                    .filter { !it.transactions.empty() }
                    .map { Triple(it.ticker.value, it.name, it.type) }
            }

        val today = LocalDate.now()

        for ((ticker, _, _) in assets) {
            val assetMonthlyPrices = getAssetMonthlyPrices(ticker, cutoffDate)
            if (assetMonthlyPrices.size < 2) {
                storeResult(ticker, today, null, 0, cdiAnnual)
                continue
            }

            val assetReturns = computeMonthlyReturns(assetMonthlyPrices, cutoffDate)

            // Align months: only use months present in both series
            val commonMonths = assetReturns.keys.intersect(ibovReturns.keys).sorted()
            if (commonMonths.size < 2) {
                storeResult(ticker, today, null, commonMonths.size, cdiAnnual)
                continue
            }

            val excessAsset = commonMonths.map { (assetReturns[it]!! - rfMonthly) }
            val excessIbov = commonMonths.map { (ibovReturns[it]!! - rfMonthly) }

            val regression = linearRegression(excessIbov, excessAsset)
            if (regression != null) {
                // Annualize monthly alpha: (1 + alpha_monthly)^12 - 1
                val alphaAnnual = (1 + regression.alpha).pow(12.0) - 1

                storeResult(
                    ticker,
                    today,
                    RegressionResult(regression.beta, alphaAnnual, regression.rSquared, regression.dataPoints),
                    regression.dataPoints,
                    cdiAnnual,
                )
            } else {
                storeResult(ticker, today, null, commonMonths.size, cdiAnnual)
            }
        }

        logger.info("Risk metrics recalculated for ${assets.size} assets")
    }

    fun getSummary(): RiskMetricsSummary {
        val latestDate =
            transaction {
                RiskMetricEntity
                    .all()
                    .orderBy(RiskMetrics.calculatedAt to SortOrder.DESC)
                    .limit(1)
                    .firstOrNull()
                    ?.calculatedAt
            } ?: return RiskMetricsSummary(emptyList(), null, null, null)

        val entities =
            transaction {
                RiskMetricEntity
                    .find { RiskMetrics.calculatedAt eq latestDate }
                    .toList()
                    .map { RiskMetricRow(it.ticker, it.beta, it.alpha, it.rSquared, it.dataPoints, it.cdiAnnual) }
            }

        val assetInfo =
            transaction {
                AssetEntity
                    .all()
                    .toList()
                    .filter { it.type in listOf("STOCK", "REIT") }
                    .associate { it.ticker.value to Pair(it.name, it.type) }
            }

        // Get current values for portfolio weighting
        val currentValues =
            transaction {
                val tickers = entities.map { it.ticker }
                tickers.associateWith { ticker ->
                    val latestPrice =
                        PriceHistories
                            .select(PriceHistories.close)
                            .where { PriceHistories.assetId eq ticker }
                            .orderBy(PriceHistories.date, SortOrder.DESC)
                            .limit(1)
                            .firstOrNull()
                            ?.get(PriceHistories.close)

                    val qty =
                        TransactionEntity
                            .find { Transactions.assetId eq ticker }
                            .toList()
                            .sumOf { tx ->
                                if (tx.type == "BUY") tx.quantity else -tx.quantity
                            }

                    if (latestPrice != null && qty > 0) qty * latestPrice else 0.0
                }
            }

        val metrics =
            entities
                .map { row ->
                    val info = assetInfo[row.ticker]
                    RiskMetricsResult(
                        ticker = row.ticker,
                        name = info?.first,
                        type = info?.second,
                        beta = row.beta,
                        alphaAnnual = row.alpha,
                        rSquared = row.rSquared,
                        dataPoints = row.dataPoints,
                        reliable = row.dataPoints >= MIN_RELIABLE_DATA_POINTS,
                    )
                }.sortedWith(compareBy({ it.type ?: "" }, { it.ticker }))

        // Portfolio weighted beta
        val totalValue = currentValues.values.sum()
        val portfolioBeta =
            if (totalValue > 0) {
                metrics
                    .filter { it.beta != null }
                    .sumOf { (currentValues[it.ticker] ?: 0.0) / totalValue * it.beta!! }
            } else {
                null
            }

        val cdiAnnual = entities.firstOrNull()?.cdiAnnual

        return RiskMetricsSummary(metrics, portfolioBeta, cdiAnnual, latestDate)
    }

    private fun getAssetMonthlyPrices(
        ticker: String,
        cutoffDate: LocalDate
    ): Map<LocalDate, Double> =
        transaction {
            PriceHistories
                .select(PriceHistories.date, PriceHistories.close)
                .where { PriceHistories.assetId eq ticker }
                .orderBy(PriceHistories.date, SortOrder.ASC)
                .toList()
                .map { it[PriceHistories.date] to it[PriceHistories.close] }
        }.filter { it.first >= cutoffDate }
            .groupBy { YearMonth.from(it.first) }
            .mapValues { (_, entries) -> entries.maxByOrNull { it.first }!!.second }
            .mapKeys { (ym, _) -> ym.atDay(1) }

    private fun storeResult(
        ticker: String,
        date: LocalDate,
        regression: RegressionResult?,
        dataPoints: Int,
        cdiAnnual: Double?,
    ) {
        transaction {
            RiskMetrics.upsert(RiskMetrics.ticker, RiskMetrics.calculatedAt) {
                it[RiskMetrics.ticker] = ticker
                it[calculatedAt] = date
                it[beta] = regression?.beta
                it[alpha] = regression?.alpha
                it[rSquared] = regression?.rSquared
                it[RiskMetrics.dataPoints] = dataPoints
                it[RiskMetrics.cdiAnnual] = cdiAnnual
            }
        }
    }

    companion object {
        fun computeMonthlyReturns(
            prices: Map<LocalDate, Double>,
            cutoffDate: LocalDate,
        ): Map<LocalDate, Double> {
            val sorted =
                prices.entries
                    .filter { it.key >= cutoffDate }
                    .sortedBy { it.key }

            if (sorted.size < 2) return emptyMap()

            val returns = mutableMapOf<LocalDate, Double>()
            for (i in 1 until sorted.size) {
                val prev = sorted[i - 1].value
                val curr = sorted[i].value
                if (prev > 0) {
                    returns[sorted[i].key] = (curr / prev) - 1.0
                }
            }
            return returns
        }

        fun linearRegression(
            x: List<Double>,
            y: List<Double>,
        ): RegressionResult? {
            val n = x.size
            if (n < 2 || n != y.size) return null

            val xMean = x.average()
            val yMean = y.average()

            var covXY = 0.0
            var varX = 0.0
            var varY = 0.0

            for (i in 0 until n) {
                val dx = x[i] - xMean
                val dy = y[i] - yMean
                covXY += dx * dy
                varX += dx * dx
                varY += dy * dy
            }

            if (varX < 1e-12) return null

            val beta = covXY / varX
            val alpha = yMean - beta * xMean
            val rSquared = if (varY > 1e-12) (covXY * covXY) / (varX * varY) else 0.0

            return RegressionResult(
                beta = beta,
                alpha = alpha,
                rSquared = rSquared,
                dataPoints = n,
            )
        }
    }
}

private data class RiskMetricRow(
    val ticker: String,
    val beta: Double?,
    val alpha: Double?,
    val rSquared: Double?,
    val dataPoints: Int,
    val cdiAnnual: Double?,
)
