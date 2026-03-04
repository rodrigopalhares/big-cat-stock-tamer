package com.stocks.service

import com.stocks.dto.AssetInfo
import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.io.StringReader
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Service
class QuoteService(private val client: HttpClient) {

    private val logger = LoggerFactory.getLogger(javaClass)
    private val json = Json { ignoreUnknownKeys = true }

    // Rate cache: key -> (rate, timestamp_seconds)
    private val rateCache = mutableMapOf<String, Pair<Double, Long>>()

    // Tesouro Direto full CSV cache
    private var tdFullCsvCache: List<TdCsvRow>? = null
    private var tdFullCsvTimestamp: Long = 0

    // Tesouro Direto latest CSV cache
    private var tdLatestCsvCache: List<TdCsvRow>? = null
    private var tdLatestCsvTimestamp: Long = 0

    // ---------- Asset info via Yahoo Finance v8 API ----------

    fun fetchAssetInfo(ticker: String): AssetInfo {
        val fallbackYf = if ("." !in ticker) "${ticker}.SA" else ticker
        val candidates = if ("." !in ticker) listOf("${ticker}.SA", ticker) else listOf(ticker)

        for (yfTicker in candidates) {
            try {
                val info = fetchYahooQuoteSummary(yfTicker) ?: continue
                val name = info["longName"] ?: info["shortName"] ?: continue

                val quoteType = (info["quoteType"] ?: "").uppercase()
                val sector = (info["sector"] ?: "").lowercase()

                val assetType = when {
                    quoteType == "ETF" -> "ETF"
                    quoteType == "EQUITY" && "real estate" in sector -> "REIT"
                    else -> "STOCK"
                }

                var currency = (info["currency"] ?: "BRL").uppercase()
                if (currency !in listOf("BRL", "USD")) currency = "BRL"

                return AssetInfo(name = name, type = assetType, yfTicker = yfTicker, currency = currency)
            } catch (e: Exception) {
                logger.debug("Error fetching info for $yfTicker: ${e.message}")
                continue
            }
        }

        return AssetInfo(name = ticker, type = "STOCK", yfTicker = fallbackYf, currency = "BRL")
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

    fun fetchExchangeRate(fromCurrency: String, toCurrency: String = "BRL"): Double {
        if (fromCurrency == toCurrency) return 1.0

        val key = "${fromCurrency}_${toCurrency}"
        val now = Instant.now().epochSecond

        val cached = rateCache[key]
        if (cached != null && now - cached.second < 300) {
            return cached.first
        }

        try {
            val yfPair = "${fromCurrency}${toCurrency}=X"
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
                val records = matched.mapNotNull { row ->
                    if (row.puCompraManha != null && row.puCompraManha > 0 && row.dataBase != null) {
                        row.dataBase to row.puCompraManha
                    } else null
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

    private fun fetchYahooQuoteSummary(yfTicker: String): Map<String, String>? {
        return runBlocking {
            try {
                val url = "https://query1.finance.yahoo.com/v8/finance/chart/$yfTicker?range=1d&interval=1d"
                val response: HttpResponse = client.get(url)
                val body = response.bodyAsText()
                val jsonObj = json.parseToJsonElement(body).jsonObject
                val result = jsonObj["chart"]?.jsonObject
                    ?.get("result")?.jsonArray?.firstOrNull()?.jsonObject
                    ?: return@runBlocking null

                val meta = result["meta"]?.jsonObject ?: return@runBlocking null
                val longName = meta["longName"]?.jsonPrimitive?.contentOrNull
                val shortName = meta["shortName"]?.jsonPrimitive?.contentOrNull
                val currency = meta["currency"]?.jsonPrimitive?.contentOrNull
                val quoteType = meta["instrumentType"]?.jsonPrimitive?.contentOrNull ?: ""

                if (longName == null && shortName == null) return@runBlocking null

                mapOf(
                    "longName" to (longName ?: ""),
                    "shortName" to (shortName ?: ""),
                    "currency" to (currency ?: "BRL"),
                    "quoteType" to quoteType,
                    "sector" to "",
                )
            } catch (e: Exception) {
                logger.debug("Yahoo quote summary error for $yfTicker: ${e.message}")
                null
            }
        }
    }

    private fun fetchSingleQuote(yfTicker: String): Double? {
        return runBlocking {
            try {
                val url = "https://query1.finance.yahoo.com/v8/finance/chart/$yfTicker?range=1d&interval=1d"
                val response: HttpResponse = client.get(url)
                val body = response.bodyAsText()
                val jsonObj = json.parseToJsonElement(body).jsonObject
                val result = jsonObj["chart"]?.jsonObject
                    ?.get("result")?.jsonArray?.firstOrNull()?.jsonObject
                    ?: return@runBlocking null

                val price = result["meta"]?.jsonObject
                    ?.get("regularMarketPrice")?.jsonPrimitive?.doubleOrNull

                if (price != null && price > 0) price else null
            } catch (e: Exception) {
                logger.debug("Yahoo quote error for $yfTicker: ${e.message}")
                null
            }
        }
    }

    private fun fetchYahooHistorical(yfTicker: String, startDate: LocalDate): List<Pair<LocalDate, Double>> {
        return runBlocking {
            try {
                val period1 = startDate.atStartOfDay().toEpochSecond(java.time.ZoneOffset.UTC)
                val period2 = Instant.now().epochSecond
                val url = "https://query1.finance.yahoo.com/v8/finance/chart/$yfTicker" +
                    "?period1=$period1&period2=$period2&interval=1d"
                val response: HttpResponse = client.get(url)
                val body = response.bodyAsText()
                val jsonObj = json.parseToJsonElement(body).jsonObject
                val result = jsonObj["chart"]?.jsonObject
                    ?.get("result")?.jsonArray?.firstOrNull()?.jsonObject
                    ?: return@runBlocking emptyList()

                val timestamps = result["timestamp"]?.jsonArray?.map {
                    it.jsonPrimitive.long
                } ?: return@runBlocking emptyList()

                val closes = result["indicators"]?.jsonObject
                    ?.get("quote")?.jsonArray?.firstOrNull()?.jsonObject
                    ?.get("close")?.jsonArray
                    ?: return@runBlocking emptyList()

                val records = mutableListOf<Pair<LocalDate, Double>>()
                for (i in timestamps.indices) {
                    val close = closes.getOrNull(i)?.jsonPrimitive?.doubleOrNull ?: continue
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
    }

    private data class TdCsvRow(
        val tipoTitulo: String,
        val dataVencimento: String,
        val dataBase: LocalDate?,
        val puCompraManha: Double?,
    )

    private val tdDateFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy")

    private fun parseTdCsv(csvText: String): List<TdCsvRow> {
        val rows = mutableListOf<TdCsvRow>()
        val reader = StringReader(csvText)
        val lines = reader.readLines()
        if (lines.isEmpty()) return rows

        val header = lines[0].split(";")
        val tipoIdx = header.indexOf("Tipo Titulo")
        val vencIdx = header.indexOf("Data Vencimento")
        val baseIdx = header.indexOf("Data Base")
        val puIdx = header.indexOf("PU Compra Manha")

        if (tipoIdx < 0 || vencIdx < 0 || baseIdx < 0 || puIdx < 0) return rows

        for (i in 1 until lines.size) {
            try {
                val cols = lines[i].split(";")
                if (cols.size <= maxOf(tipoIdx, vencIdx, baseIdx, puIdx)) continue

                val dataBase = try {
                    LocalDate.parse(cols[baseIdx], tdDateFormatter)
                } catch (e: Exception) { null }

                val puStr = cols[puIdx].replace(",", ".")
                val pu = puStr.toDoubleOrNull()

                rows.add(TdCsvRow(
                    tipoTitulo = cols[tipoIdx],
                    dataVencimento = cols[vencIdx],
                    dataBase = dataBase,
                    puCompraManha = pu,
                ))
            } catch (e: Exception) {
                continue
            }
        }
        return rows
    }

    private fun getTdFullCsv(): List<TdCsvRow> {
        val now = Instant.now().epochSecond
        if (tdFullCsvCache != null && now - tdFullCsvTimestamp < 3600) {
            return tdFullCsvCache!!
        }

        val url = "https://www.tesourotransparente.gov.br/ckan/dataset/" +
            "df56aa42-484a-4a59-8184-7676580c81e3/resource/" +
            "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"

        return try {
            val csvText = runBlocking { client.get(url).bodyAsText() }
            val rows = parseTdCsv(csvText)
            tdFullCsvCache = rows
            tdFullCsvTimestamp = now
            rows
        } catch (e: Exception) {
            logger.error("Error fetching full Tesouro Direto CSV: ${e.message}")
            emptyList()
        }
    }

    private fun getTdLatestCsv(): List<TdCsvRow> {
        val now = Instant.now().epochSecond
        if (tdLatestCsvCache != null && now - tdLatestCsvTimestamp < 3600) {
            return tdLatestCsvCache!!
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
