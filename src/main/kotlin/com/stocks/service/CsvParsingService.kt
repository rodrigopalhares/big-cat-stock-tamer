package com.stocks.service

import com.stocks.dto.AssetBatchRow
import com.stocks.dto.AssetStatus
import com.stocks.dto.BatchRequest
import com.stocks.dto.CsvAssetRow
import com.stocks.dto.CsvRow
import com.stocks.dto.VALID_CURRENCIES
import com.stocks.model.AssetEntity
import com.stocks.model.TransactionEntity
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.math.abs

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

@Service
class CsvParsingService(
    private val quoteService: QuoteService,
    private val transactionService: TransactionService,
    private val exchangeRateService: ExchangeRateService,
) {
    /**
     * Parse tab-separated CSV rows from a Brazilian brokerage spreadsheet.
     *
     * Expected columns (tab-separated):
     * stock  date  type(C/V)  quantity  unit_price  taxes  broker  irrf  currency  notes
     */
    fun parseCsvRows(
        rawCsv: String,
        existingTickers: Set<String>,
        assetInfoResolver: (String) -> AssetStatus,
    ): List<CsvRow> {
        val lines = rawCsv.lines().filter { it.isNotBlank() }
        if (lines.isEmpty()) return emptyList()

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

    /**
     * Parse CSV text and resolve asset statuses for unknown tickers.
     */
    fun parseCsvWithAssetLookup(csv: String): List<CsvRow> {
        val existingTickers = transaction { AssetEntity.all().map { it.ticker.value }.toSet() }

        return parseCsvRows(csv, existingTickers) { ticker ->
            val info = quoteService.fetchAssetInfo(ticker)
            if (info.name != ticker) AssetStatus.WILL_CREATE else AssetStatus.UNKNOWN
        }
    }

    /**
     * Extract distinct tickers from CSV and resolve asset info for each.
     */
    fun extractDistinctAssets(rawCsv: String): List<CsvAssetRow> {
        val lines = rawCsv.lines().filter { it.isNotBlank() }
        val tickers =
            lines
                .mapNotNull { line ->
                    val cols = line.split("\t")
                    cols
                        .getOrNull(0)
                        ?.trim()
                        ?.uppercase()
                        ?.takeIf { it.isNotBlank() }
                }.distinct()

        val existingTickers = transaction { AssetEntity.all().map { it.ticker.value }.toSet() }

        return tickers.map { ticker ->
            if (ticker in existingTickers) {
                val asset = transaction { AssetEntity.findById(ticker)!! }
                CsvAssetRow(
                    ticker = ticker,
                    name = transaction { asset.name ?: "" },
                    type = transaction { asset.type ?: "STOCK" },
                    yfTicker = transaction { asset.yfTicker ?: "" },
                    currency = transaction { asset.currency },
                    assetStatus = AssetStatus.EXISTS,
                )
            } else {
                val info = quoteService.fetchAssetInfo(ticker)
                val found = info.name != ticker
                CsvAssetRow(
                    ticker = ticker,
                    name = if (found) info.name else "",
                    type = if (found) info.type else "STOCK",
                    yfTicker = info.yfTicker,
                    currency = info.currency,
                    assetStatus = if (found) AssetStatus.WILL_CREATE else AssetStatus.UNKNOWN,
                )
            }
        }
    }

    /**
     * Batch import transactions from parsed CSV rows.
     * Creates new assets from the provided asset list before inserting transactions.
     */
    fun batchImport(
        request: BatchRequest,
        newAssets: List<AssetBatchRow> = emptyList(),
    ): Int {
        var inserted = 0
        transaction {
            for (asset in newAssets) {
                val normalized = asset.ticker.uppercase().trim()
                if (AssetEntity.findById(normalized) == null) {
                    AssetEntity.new(normalized) {
                        yfTicker = asset.yfTicker.ifBlank { null }
                        name = asset.name.ifBlank { null }
                        type = asset.type.ifBlank { "STOCK" }
                        currency = asset.currency.ifBlank { "BRL" }
                    }
                }
            }

            for (row in request.rows) {
                val normalized = row.ticker.uppercase().trim()
                val asset = transactionService.findOrCreateAsset(normalized)
                val txDate = LocalDate.parse(row.date)
                val rate =
                    if (asset.currency != "BRL") {
                        exchangeRateService.getRate(asset.currency, "BRL", txDate)
                    } else {
                        1.0
                    }

                TransactionEntity.new {
                    assetId = normalized
                    type = row.type.uppercase()
                    quantity = row.quantity
                    price = row.price
                    fees = row.fees
                    priceBrl = row.price * rate
                    feesBrl = row.fees * rate
                    date = txDate
                    broker = row.broker.ifBlank { null }
                    notes = row.notes.ifBlank { null }
                }
                inserted++
            }
        }
        return inserted
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

        val dateStr = cols[1].trim()
        val isoDate =
            try {
                LocalDate.parse(dateStr, BR_DATE_FORMAT).format(DateTimeFormatter.ISO_LOCAL_DATE)
            } catch (e: Exception) {
                return errorRow("Data inválida: $dateStr")
            }

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
            quantity = if (type == "SELL") -absQuantity else absQuantity,
            price = price,
            fees = fees,
            broker = broker,
            notes = notes,
            currency = currency,
            assetStatus = assetStatus,
        )
    }
}
