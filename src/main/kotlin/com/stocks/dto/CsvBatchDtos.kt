package com.stocks.dto

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.math.abs

enum class AssetStatus {
    EXISTS,
    WILL_CREATE,
    UNKNOWN,
}

data class CsvAssetRow(
    val ticker: String,
    val name: String,
    val type: String,
    val yfTicker: String,
    val currency: String,
    val assetStatus: AssetStatus,
)

data class AssetBatchRequest(
    val assets: List<AssetBatchRow>,
)

data class AssetBatchRow(
    val ticker: String,
    val name: String,
    val type: String,
    val yfTicker: String,
    val currency: String,
)

data class CsvRow(
    val rowIndex: Int,
    val ticker: String,
    val date: String,
    val type: String,
    val quantity: Double,
    val price: Double,
    val fees: Double,
    val broker: String,
    val notes: String,
    val currency: String,
    val assetStatus: AssetStatus,
    val error: String? = null,
)

data class BatchRequest(
    val rows: List<BatchRowRequest>,
)

data class BatchRowRequest(
    val ticker: String,
    val date: String,
    val type: String,
    val quantity: Double,
    val price: Double,
    val fees: Double,
    val broker: String,
    val notes: String,
    val currency: String,
)

private val BR_DATE_FORMAT = DateTimeFormatter.ofPattern("dd/MM/yyyy")

/**
 * Parse a Brazilian number string like "1.234,56" into a Double.
 * Handles both "1234,56" and "1.234,56" formats.
 */
fun parseBrazilianNumber(raw: String): Double? {
    val trimmed = raw.trim()
    if (trimmed.isBlank()) return 0.0
    val normalized = trimmed.replace(".", "").replace(",", ".")
    return normalized.toDoubleOrNull()
}

/**
 * Parse tab-separated CSV rows from a Brazilian brokerage spreadsheet.
 *
 * Expected columns (tab-separated):
 * stock  date  type(C/V)  quantity  unit_price  taxes  broker  irrf  currency  notes
 *
 * @param rawCsv the raw pasted text
 * @param existingTickers set of tickers already in the DB
 * @param assetInfoResolver called once per unknown ticker to check if Yahoo Finance knows it;
 *        returns the AssetStatus for the ticker
 */
fun parseCsvRows(
    rawCsv: String,
    existingTickers: Set<String>,
    assetInfoResolver: (String) -> AssetStatus,
): List<CsvRow> {
    val lines = rawCsv.lines().filter { it.isNotBlank() }
    if (lines.isEmpty()) return emptyList()

    // Deduplicate unknown tickers to avoid N+1 API calls
    val allTickers =
        lines
            .mapNotNull { line ->
                val cols = line.split("\t")
                cols
                    .getOrNull(0)
                    ?.trim()
                    ?.uppercase()
                    ?.takeIf { it.isNotBlank() }
            }.toSet()

    val unknownTickers = allTickers - existingTickers
    val resolvedStatuses = unknownTickers.associateWith { assetInfoResolver(it) }

    return lines.mapIndexed { index, line ->
        parseSingleRow(index, line, existingTickers, resolvedStatuses)
    }
}

private fun parseSingleRow(
    index: Int,
    line: String,
    existingTickers: Set<String>,
    resolvedStatuses: Map<String, AssetStatus>,
): CsvRow {
    val cols = line.split("\t")

    val errorRow = { msg: String ->
        CsvRow(
            rowIndex = index,
            ticker = cols.getOrElse(0) { "" }.trim().uppercase(),
            date = cols.getOrElse(1) { "" }.trim(),
            type = cols.getOrElse(2) { "" }.trim().uppercase(),
            quantity = 0.0,
            price = 0.0,
            fees = 0.0,
            broker = cols.getOrElse(6) { "" }.trim(),
            notes = cols.getOrElse(9) { "" }.trim(),
            currency = cols.getOrElse(8) { "BRL" }.trim().uppercase(),
            assetStatus = AssetStatus.UNKNOWN,
            error = msg,
        )
    }

    if (cols.size < 7) {
        return errorRow("Colunas insuficientes (esperado pelo menos 7, encontrado ${cols.size})")
    }

    val ticker = cols[0].trim().uppercase()
    if (ticker.isBlank()) return errorRow("Ticker vazio")

    // Parse date dd/MM/yyyy -> yyyy-MM-dd
    val dateStr = cols[1].trim()
    val isoDate =
        try {
            LocalDate.parse(dateStr, BR_DATE_FORMAT).format(DateTimeFormatter.ISO_LOCAL_DATE)
        } catch (e: Exception) {
            return errorRow("Data inválida: $dateStr")
        }

    // Map C -> BUY, V -> SELL
    val rawType = cols[2].trim().uppercase()
    val type =
        when (rawType) {
            "C" -> "BUY"
            "V" -> "SELL"
            "BUY" -> "BUY"
            "SELL" -> "SELL"
            else -> return errorRow("Tipo inválido: $rawType (esperado C ou V)")
        }

    val quantity = parseBrazilianNumber(cols[3]) ?: return errorRow("Quantidade inválida: ${cols[3]}")
    val absQuantity = abs(quantity)
    if (absQuantity <= 0) return errorRow("Quantidade deve ser > 0")

    val price = parseBrazilianNumber(cols[4]) ?: return errorRow("Preço inválido: ${cols[4]}")
    if (price <= 0) return errorRow("Preço deve ser > 0")

    val taxes = parseBrazilianNumber(cols[5]) ?: 0.0
    val broker = cols.getOrElse(6) { "" }.trim()
    val irrf = cols.getOrElse(7) { "" }.let { parseBrazilianNumber(it) ?: 0.0 }
    val currency =
        cols
            .getOrElse(8) { "BRL" }
            .trim()
            .uppercase()
            .let { if (it in VALID_CURRENCIES) it else "BRL" }
    val rawNotes = cols.getOrElse(9) { "" }.trim()

    val fees = taxes + irrf
    val notes =
        buildString {
            append(rawNotes)
            if (irrf > 0) {
                if (isNotBlank()) append(" ")
                append("IRRF: ${String.format("%.2f", irrf).replace(".", ",")}")
            }
        }

    val assetStatus =
        when {
            ticker in existingTickers -> AssetStatus.EXISTS
            else -> resolvedStatuses[ticker] ?: AssetStatus.UNKNOWN
        }

    return CsvRow(
        rowIndex = index,
        ticker = ticker,
        date = isoDate,
        type = type,
        quantity = absQuantity,
        price = price,
        fees = fees,
        broker = broker,
        notes = notes,
        currency = currency,
        assetStatus = assetStatus,
    )
}
