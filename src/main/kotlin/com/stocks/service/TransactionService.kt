package com.stocks.service

import com.stocks.dto.AssetBatchRow
import com.stocks.dto.AssetInfo
import com.stocks.dto.AssetStatus
import com.stocks.dto.BatchRequest
import com.stocks.dto.CsvAssetRow
import com.stocks.dto.CsvRow
import com.stocks.dto.parseCsvRows
import com.stocks.model.AssetEntity
import com.stocks.model.TransactionEntity
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.time.LocalDate

/**
 * Result of resolving price from either unit price or total price input.
 */
data class ResolvedPrice(
    val price: Double,
    val fees: Double
)

/**
 * Result of looking up ticker info for the transaction form.
 */
data class TickerLookupResult(
    val ticker: String,
    val name: String?,
    val type: String?,
    val status: TickerLookupStatus,
)

enum class TickerLookupStatus {
    EXISTS,
    FOUND_ONLINE,
    NOT_FOUND,
}

@Service
class TransactionService(
    private val quoteService: QuoteService,
    private val calculationService: CalculationService,
) {
    /**
     * Find an existing asset or auto-create it by fetching info from Yahoo Finance.
     */
    fun findOrCreateAsset(ticker: String): AssetEntity {
        val normalized = ticker.uppercase().trim()
        return transaction {
            AssetEntity.findById(normalized) ?: run {
                val info = quoteService.fetchAssetInfo(normalized)
                AssetEntity.new(normalized) {
                    yfTicker = info.yfTicker
                    name = if (info.name != normalized) info.name else null
                    this.type = info.type
                    currency = info.currency
                }
            }
        }
    }

    /**
     * Resolve the effective unit price and fees from the form inputs.
     * When totalPrice is provided, calculates the missing value (price or fees).
     */
    fun resolvePrice(
        price: Double?,
        totalPrice: Double?,
        fees: Double,
        quantity: Double,
    ): ResolvedPrice {
        var resolvedPrice = price
        var resolvedFees = fees

        if (totalPrice != null && totalPrice > 0) {
            if (resolvedPrice != null && resolvedPrice > 0) {
                resolvedFees = totalPrice - quantity * resolvedPrice
            } else {
                resolvedPrice = (totalPrice - resolvedFees) / quantity
            }
        }

        if (resolvedPrice == null || resolvedPrice <= 0) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o preço unitário ou o valor total")
        }

        return ResolvedPrice(resolvedPrice, resolvedFees)
    }

    /**
     * Create a transaction, auto-creating the asset if needed.
     */
    fun createTransaction(
        ticker: String,
        type: String,
        quantity: Double,
        price: Double,
        fees: Double,
        date: LocalDate,
        broker: String?,
        notes: String?,
    ): TransactionEntity {
        val normalized = ticker.uppercase().trim()
        return transaction {
            findOrCreateAsset(normalized)
            TransactionEntity.new {
                assetId = normalized
                this.type = type.uppercase()
                this.quantity = quantity
                this.price = price
                this.fees = fees
                this.date = date
                this.broker = broker?.ifBlank { null }
                this.notes = notes?.ifBlank { null }
            }
        }
    }

    /**
     * Create a transaction for a pre-existing asset (API route).
     * Throws 404 if asset does not exist.
     */
    fun createTransactionForExistingAsset(
        assetId: String,
        type: String,
        quantity: Double,
        price: Double,
        fees: Double,
        date: LocalDate,
        broker: String?,
        notes: String?,
    ): TransactionEntity =
        transaction {
            val asset =
                AssetEntity.findById(assetId.uppercase())
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")

            TransactionEntity.new {
                this.assetId = asset.ticker.value
                this.type = type.uppercase().trim()
                this.quantity = quantity
                this.price = price
                this.fees = fees
                this.date = date
                this.broker = broker
                this.notes = notes
            }
        }

    /**
     * List transactions, optionally filtered by ticker, asset type, and position status.
     */
    fun listTransactions(
        ticker: String?,
        type: String? = null,
        position: String? = null,
    ): List<TransactionEntity> =
        transaction {
            val eligibleTickers = resolveEligibleTickers(type, position)

            var query =
                TransactionEntity
                    .all()
                    .sortedWith(compareByDescending<TransactionEntity> { it.date }.thenByDescending { it.id.value })

            if (ticker != null) {
                query = query.filter { it.assetId == ticker.uppercase() }
            }

            if (eligibleTickers != null) {
                query = query.filter { it.assetId in eligibleTickers }
            }

            query.toList()
        }

    private fun resolveEligibleTickers(
        type: String?,
        position: String?,
    ): Set<String>? {
        val hasTypeFilter = !type.isNullOrBlank()
        val hasPositionFilter = !position.isNullOrBlank() && position != "all"
        if (!hasTypeFilter && !hasPositionFilter) return null

        return transaction {
            var assets = AssetEntity.all().toList()

            if (hasTypeFilter) {
                assets = assets.filter { it.type == type }
            }

            if (hasPositionFilter) {
                val allTxByAsset =
                    TransactionEntity.all().toList().groupBy { it.assetId }
                val tickersWithPosition =
                    allTxByAsset
                        .filter { (_, txs) ->
                            val data =
                                txs.map {
                                    TransactionData(
                                        type = it.type,
                                        quantity = it.quantity,
                                        price = it.price,
                                        fees = it.fees,
                                        date = it.date,
                                    )
                                }
                            calculationService.calculatePosition(data).quantity > 0
                        }.keys

                assets =
                    when (position) {
                        "with" -> assets.filter { it.ticker.value in tickersWithPosition }
                        "without" -> assets.filter { it.ticker.value !in tickersWithPosition }
                        else -> assets
                    }
            }

            assets.map { it.ticker.value }.toSet()
        }
    }

    /**
     * Delete a transaction by ID. Throws 404 if not found.
     */
    fun deleteTransaction(id: Int) {
        transaction {
            val tx =
                TransactionEntity.findById(id)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Transaction not found")
            tx.delete()
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
                findOrCreateAsset(normalized)

                TransactionEntity.new {
                    assetId = normalized
                    type = row.type.uppercase()
                    quantity = row.quantity
                    price = row.price
                    fees = row.fees
                    date = LocalDate.parse(row.date)
                    broker = row.broker.ifBlank { null }
                    notes = row.notes.ifBlank { null }
                }
                inserted++
            }
        }
        return inserted
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
                val info: AssetInfo = quoteService.fetchAssetInfo(ticker)
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
     * Look up ticker info from the database or Yahoo Finance.
     */
    fun lookupTickerInfo(ticker: String): TickerLookupResult {
        val normalized = ticker.uppercase().trim()
        if (normalized.length < 3) {
            return TickerLookupResult(normalized, null, null, TickerLookupStatus.NOT_FOUND)
        }

        val existing = transaction { AssetEntity.findById(normalized) }
        if (existing != null) {
            val name = transaction { existing.name }
            val type = transaction { existing.type ?: "STOCK" }
            return TickerLookupResult(normalized, name, type, TickerLookupStatus.EXISTS)
        }

        val info = quoteService.fetchAssetInfo(normalized)
        val found = info.name != normalized
        return if (found) {
            TickerLookupResult(normalized, info.name, info.type, TickerLookupStatus.FOUND_ONLINE)
        } else {
            TickerLookupResult(normalized, null, null, TickerLookupStatus.NOT_FOUND)
        }
    }
}
