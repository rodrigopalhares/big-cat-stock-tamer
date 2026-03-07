package com.stocks.service

import com.github.doyaaaaaken.kotlincsv.dsl.csvReader
import com.stocks.dto.AssetInfo
import com.stocks.dto.YahooChartResponse
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import org.springframework.web.client.body
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap

private const val USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

@Service
class QuoteService(
    private val restClient: RestClient
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    private val rateCache = ConcurrentHashMap<String, Pair<Double, Long>>()

    @Volatile
    private var tdFullCsvCache: List<TdCsvRow>? = null

    @Volatile
    private var tdFullCsvTimestamp: Long = 0

    @Volatile
    private var tdLatestCsvCache: List<TdCsvRow>? = null

    @Volatile
    private var tdLatestCsvTimestamp: Long = 0

    // ---------- Asset info via Yahoo Finance v8 API ----------

    fun fetchAssetInfo(ticker: String): AssetInfo {
        val classification = classifyTicker(ticker)
        val candidates = classification.yfCandidates
        val fallbackYf = candidates.first()

        for (yfTicker in candidates) {
            try {
                val response = fetchYahooChart(yfTicker, "1d", "1d")
                val result = response?.chart?.result?.firstOrNull() ?: continue
                val meta = result.meta ?: continue

                val name = meta.longName ?: meta.shortName ?: continue
                val quoteType = (meta.instrumentType ?: "").uppercase()
                val symbol = meta.symbol ?: yfTicker

                val assetType =
                    when {
                        quoteType == "ETF" -> "ETF"
                        quoteType == "EQUITY" && isBrazilianReit(symbol, name) -> "REIT"
                        classification.suggestedType != null -> classification.suggestedType
                        else -> "STOCK"
                    }

                var currency = (meta.currency ?: classification.defaultCurrency).uppercase()
                if (currency !in listOf("BRL", "USD")) currency = classification.defaultCurrency

                return AssetInfo(name = name, type = assetType, yfTicker = yfTicker, currency = currency)
            } catch (e: Exception) {
                logger.debug("Error fetching info for $yfTicker: ${e.message}")
                continue
            }
        }

        val fallbackType = classification.suggestedType ?: "STOCK"
        return AssetInfo(name = ticker, type = fallbackType, yfTicker = fallbackYf, currency = classification.defaultCurrency)
    }

    // ---------- Current quotes ----------

    fun fetchQuotesBatch(yfTickers: List<String>): Map<String, Double> {
        if (yfTickers.isEmpty()) return emptyMap()

        val results = mutableMapOf<String, Double>()
        for (ticker in yfTickers) {
            try {
                val price = fetchSingleQuote(ticker)
                if (price != null && price > 0) {
                    results[ticker] = price
                }
            } catch (e: Exception) {
                logger.warn("Error fetching quote for $ticker: ${e.message}")
            }
        }
        return results
    }

    fun fetchExchangeRate(
        fromCurrency: String,
        toCurrency: String = "BRL"
    ): Double {
        if (fromCurrency == toCurrency) return 1.0

        val key = "${fromCurrency}_$toCurrency"
        val now = Instant.now().epochSecond

        val cached = rateCache[key]
        if (cached != null && now - cached.second < 300) {
            return cached.first
        }

        try {
            val yfPair = "${fromCurrency}$toCurrency=X"
            val price = fetchSingleQuote(yfPair)
            if (price != null && price > 0) {
                rateCache[key] = price to now
                return price
            }
        } catch (e: Exception) {
            logger.debug("Error fetching exchange rate $fromCurrency/$toCurrency: ${e.message}")
        }

        return rateCache[key]?.first ?: 6.0
    }

    // ---------- Historical quotes ----------

    fun fetchHistoricalQuotesBatch(
        yfTickerMap: Map<String, String>,
        startDate: LocalDate
    ): Map<String, List<Pair<LocalDate, Double>>> {
        if (yfTickerMap.isEmpty()) return emptyMap()

        val results = mutableMapOf<String, List<Pair<LocalDate, Double>>>()
        for ((yfTicker, assetTicker) in yfTickerMap) {
            try {
                val prices = fetchYahooHistorical(yfTicker, startDate)
                if (prices.isNotEmpty()) {
                    results[assetTicker] = prices
                }
            } catch (e: Exception) {
                logger.warn("Error fetching historical data for $yfTicker: ${e.message}")
            }
        }
        return results
    }

    // ---------- Tesouro Direto ----------

    fun fetchTdQuotesBatch(yfTickers: List<String>): Map<String, Double> {
        if (yfTickers.isEmpty()) return emptyMap()

        val rows = getTdLatestCsv()
        if (rows.isEmpty()) return emptyMap()

        val results = mutableMapOf<String, Double>()
        for (yfTicker in yfTickers) {
            try {
                if (";" !in yfTicker) {
                    logger.warn("Invalid TD yf_ticker format: $yfTicker")
                    continue
                }
                val (title, maturity) = yfTicker.split(";", limit = 2)
                val matched = rows.filter { it.tipoTitulo == title && it.dataVencimento == maturity }
                val price = matched.firstOrNull()?.puCompraManha
                if (price != null && price > 0) {
                    results[yfTicker] = price
                }
            } catch (e: Exception) {
                logger.warn("Error parsing TD quote for $yfTicker: ${e.message}")
            }
        }
        return results
    }

    fun fetchTdHistoricalQuotesBatch(yfTickers: List<String>): Map<String, List<Pair<LocalDate, Double>>> {
        if (yfTickers.isEmpty()) return emptyMap()

        val rows = getTdFullCsv()
        if (rows.isEmpty()) return emptyMap()

        val results = mutableMapOf<String, List<Pair<LocalDate, Double>>>()
        for (yfTicker in yfTickers) {
            try {
                if (";" !in yfTicker) {
                    logger.warn("Invalid TD yf_ticker format: $yfTicker")
                    continue
                }
                val (title, maturity) = yfTicker.split(";", limit = 2)
                val matched = rows.filter { it.tipoTitulo == title && it.dataVencimento == maturity }
                val records =
                    matched
                        .mapNotNull { row ->
                            if (row.puCompraManha != null && row.puCompraManha > 0 && row.dataBase != null) {
                                row.dataBase to row.puCompraManha
                            } else {
                                null
                            }
                        }.sortedBy { it.first }
                if (records.isNotEmpty()) {
                    results[yfTicker] = records
                }
            } catch (e: Exception) {
                logger.warn("Error extracting TD historical data for $yfTicker: ${e.message}")
            }
        }
        return results
    }

    // ---------- Private helpers ----------

    private val reitNameKeywords = listOf("fii", "fundo de investimento imobili", "fdo inv imob")

    private fun isBrazilianReit(
        symbol: String,
        name: String
    ): Boolean {
        val baseTicker = symbol.removeSuffix(".SA")
        if (baseTicker.length >= 5 && baseTicker.endsWith("11") && baseTicker.dropLast(2).all { it.isLetter() }) {
            return true
        }
        val lowerName = name.lowercase()
        return reitNameKeywords.any { it in lowerName }
    }

    private fun fetchYahooChart(
        yfTicker: String,
        range: String,
        interval: String
    ): YahooChartResponse? {
        val url = "https://query1.finance.yahoo.com/v8/finance/chart/$yfTicker?range=$range&interval=$interval"
        logger.info(url)
        return try {
            restClient
                .get()
                .uri(url)
                .header("User-Agent", USER_AGENT)
                .retrieve()
                .body<YahooChartResponse>()
        } catch (e: Exception) {
            logger.warn("Yahoo API error for $yfTicker: ${e.message}")
            null
        }
    }

    private fun fetchSingleQuote(yfTicker: String): Double? {
        val response = fetchYahooChart(yfTicker, "1d", "1d")
        return response
            ?.chart
            ?.result
            ?.firstOrNull()
            ?.meta
            ?.regularMarketPrice
    }

    private fun fetchYahooHistorical(
        yfTicker: String,
        startDate: LocalDate
    ): List<Pair<LocalDate, Double>> {
        val period1 = startDate.atStartOfDay().toEpochSecond(ZoneOffset.UTC)
        val period2 = Instant.now().epochSecond
        val url = "https://query1.finance.yahoo.com/v8/finance/chart/$yfTicker?period1=$period1&period2=$period2&interval=1d"
        logger.info(url)

        return try {
            val response =
                restClient
                    .get()
                    .uri(url)
                    .header("User-Agent", USER_AGENT)
                    .retrieve()
                    .body<YahooChartResponse>()
            val result = response?.chart?.result?.firstOrNull() ?: return emptyList()

            val timestamps = result.timestamp ?: return emptyList()
            val closes =
                result.indicators
                    ?.quote
                    ?.firstOrNull()
                    ?.close ?: return emptyList()

            val records = mutableListOf<Pair<LocalDate, Double>>()
            for (i in timestamps.indices) {
                val close = closes.getOrNull(i) ?: continue
                if (close <= 0) continue
                val date = LocalDate.ofEpochDay(timestamps[i] / 86400)
                records.add(date to close)
            }
            records.sortedBy { it.first }
        } catch (e: Exception) {
            logger.warn("Yahoo historical error for $yfTicker: ${e.message}")
            emptyList()
        }
    }

    private data class TdCsvRow(
        val tipoTitulo: String,
        val dataVencimento: String,
        val dataBase: LocalDate?,
        val puCompraManha: Double?,
    )

    private val tdDateFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy")

    private fun parseTdCsv(csvText: String): List<TdCsvRow> =
        try {
            csvReader {
                delimiter = ';'
            }.readAllWithHeader(csvText).map { rawRow ->
                val row = rawRow.mapKeys { it.key.lowercase().trim() }
                val tipoTitulo = row["tipo titulo"] ?: ""
                val dataVencimento = row["data vencimento"] ?: ""
                val dataBase =
                    try {
                        LocalDate.parse(row["data base"].orEmpty(), tdDateFormatter)
                    } catch (e: Exception) {
                        logger.warn("Error parsing TD date ${row["data base"]} for row $tipoTitulo $dataVencimento: ${e.message}")
                        null
                    }

                val puStr = row["pu compra manha"]?.replace(",", ".")
                val pu = puStr?.toDoubleOrNull()

                TdCsvRow(
                    tipoTitulo = tipoTitulo,
                    dataVencimento = dataVencimento,
                    dataBase = dataBase,
                    puCompraManha = pu
                )
            }
        } catch (e: Exception) {
            logger.error("Error parsing TD CSV: ${e.message}")
            emptyList()
        }

    @Synchronized
    private fun getTdFullCsv(): List<TdCsvRow> {
        val now = Instant.now().epochSecond
        tdFullCsvCache?.let { cache ->
            if (now - tdFullCsvTimestamp < 4 * 3600) return cache
        }

        val url =
            "https://www.tesourotransparente.gov.br/ckan/dataset/" +
                "df56aa42-484a-4a59-8184-7676580c81e3/resource/" +
                "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"

        return try {
            val csvText =
                restClient
                    .get()
                    .uri(url)
                    .retrieve()
                    .body<String>() ?: ""
            val rows = parseTdCsv(csvText)
            tdFullCsvCache = rows
            tdFullCsvTimestamp = now
            rows
        } catch (e: Exception) {
            logger.error("Error fetching full Tesouro Direto CSV: ${e.message}")
            emptyList()
        }
    }

    @Synchronized
    private fun getTdLatestCsv(): List<TdCsvRow> {
        val now = Instant.now().epochSecond
        tdLatestCsvCache?.let { cache ->
            if (now - tdLatestCsvTimestamp < 4 * 3600) return cache
        }

        val allRows = getTdFullCsv()
        if (allRows.isEmpty()) return emptyList()

        val latestDate = allRows.mapNotNull { it.dataBase }.maxOrNull() ?: return emptyList()
        val latest = allRows.filter { it.dataBase == latestDate }
        tdLatestCsvCache = latest
        tdLatestCsvTimestamp = now
        return latest
    }
}
