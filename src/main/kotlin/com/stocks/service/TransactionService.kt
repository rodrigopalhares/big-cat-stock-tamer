package com.stocks.service

import com.stocks.model.AssetEntity
import com.stocks.model.TransactionEntity
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.time.LocalDate

/**
 * Result of resolving price from either unit price or total price input.
 */
data class ResolvedPrice(
    val price: Double,
    val fees: Double,
)

data class ConvertedPrices(
    val price: Double,
    val fees: Double,
    val priceBrl: Double,
    val feesBrl: Double,
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
    private val exchangeRateService: ExchangeRateService,
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
        inputCurrency: String? = null,
    ): TransactionEntity {
        val normalized = ticker.uppercase().trim()
        return transaction {
            val asset = findOrCreateAsset(normalized)
            val effectiveInputCurrency = inputCurrency?.ifBlank { null } ?: asset.currency
            val converted = convertPrices(price, fees, effectiveInputCurrency, asset.currency, date)
            TransactionEntity.new {
                assetId = normalized
                this.type = type.uppercase()
                this.quantity = if (type.uppercase() == "SELL") -quantity else quantity
                this.price = converted.price
                this.fees = converted.fees
                this.priceBrl = converted.priceBrl
                this.feesBrl = converted.feesBrl
                this.currency = asset.currency
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
        inputCurrency: String? = null,
    ): TransactionEntity =
        transaction {
            val asset =
                AssetEntity.findById(assetId.uppercase())
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")
            val effectiveInputCurrency = inputCurrency?.ifBlank { null } ?: asset.currency
            val converted = convertPrices(price, fees, effectiveInputCurrency, asset.currency, date)

            TransactionEntity.new {
                this.assetId = asset.ticker.value
                this.type = type.uppercase().trim()
                this.quantity = if (type.uppercase().trim() == "SELL") -quantity else quantity
                this.price = converted.price
                this.fees = converted.fees
                this.priceBrl = converted.priceBrl
                this.feesBrl = converted.feesBrl
                this.currency = asset.currency
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
     * Update an existing transaction by ID. Throws 404 if not found.
     */
    fun updateTransaction(
        id: Int,
        type: String,
        quantity: Double,
        price: Double,
        fees: Double,
        date: LocalDate,
        broker: String?,
        notes: String?,
        inputCurrency: String? = null,
    ) {
        transaction {
            val tx =
                TransactionEntity.findById(id)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Transaction not found")
            val asset = AssetEntity.findById(tx.assetId)
            val assetCurrency = asset?.currency ?: "BRL"
            val effectiveInputCurrency = inputCurrency?.ifBlank { null } ?: assetCurrency
            val converted = convertPrices(price, fees, effectiveInputCurrency, assetCurrency, date)
            tx.type = type.uppercase()
            tx.quantity = if (type.uppercase() == "SELL") -quantity else quantity
            tx.price = converted.price
            tx.fees = converted.fees
            tx.priceBrl = converted.priceBrl
            tx.feesBrl = converted.feesBrl
            tx.currency = assetCurrency
            tx.date = date
            tx.broker = broker?.ifBlank { null }
            tx.notes = notes?.ifBlank { null }
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
     * Convert input prices to asset currency and BRL.
     *
     * The transaction always stores values in the asset's currency.
     * If the user enters values in a different currency, this method converts them.
     */
    internal fun convertPrices(
        inputPrice: Double,
        inputFees: Double,
        inputCurrency: String,
        assetCurrency: String,
        date: LocalDate,
    ): ConvertedPrices {
        if (inputCurrency == assetCurrency) {
            if (assetCurrency == "BRL") {
                return ConvertedPrices(inputPrice, inputFees, inputPrice, inputFees)
            }
            val rate = exchangeRateService.getRate(assetCurrency, "BRL", date)
            return ConvertedPrices(inputPrice, inputFees, inputPrice * rate, inputFees * rate)
        }

        if (inputCurrency == "BRL") {
            // User typed BRL values for a foreign-currency asset (e.g., USD)
            val rate = exchangeRateService.getRate(assetCurrency, "BRL", date)
            return ConvertedPrices(inputPrice / rate, inputFees / rate, inputPrice, inputFees)
        }

        // User typed foreign currency values for a BRL asset
        check(assetCurrency == "BRL") {
            "Unsupported conversion: inputCurrency=$inputCurrency, assetCurrency=$assetCurrency"
        }
        val rate = exchangeRateService.getRate(inputCurrency, "BRL", date)
        val pBrl = inputPrice * rate
        val fBrl = inputFees * rate
        return ConvertedPrices(pBrl, fBrl, pBrl, fBrl)
    }

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
