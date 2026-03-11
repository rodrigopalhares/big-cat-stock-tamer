package com.stocks

import com.stocks.model.AssetEntity
import com.stocks.model.DividendEntity
import com.stocks.model.ExchangeRates
import com.stocks.model.MonthlySnapshotEntity
import com.stocks.model.PriceHistoryEntity
import com.stocks.model.TransactionEntity
import org.jetbrains.exposed.v1.jdbc.deleteAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import java.time.LocalDate

fun createAsset(
    ticker: String,
    name: String = ticker,
    type: String = "STOCK",
    currency: String = "BRL",
    yfTicker: String? = null,
    delisted: Boolean = false,
) = transaction {
    AssetEntity.new(ticker) {
        this.name = name
        this.type = type
        this.currency = currency
        this.yfTicker = yfTicker
        this.delisted = delisted
    }
}

fun createTransaction(
    ticker: String,
    type: String = "BUY",
    quantity: Double = 10.0,
    price: Double = 30.0,
    fees: Double = 0.0,
    date: LocalDate = LocalDate.of(2024, 1, 15),
    broker: String? = null,
    priceBrl: Double? = null,
    feesBrl: Double? = null,
) = transaction {
    TransactionEntity.new {
        this.assetId = ticker
        this.type = type
        this.quantity = quantity
        this.price = price
        this.fees = fees
        this.priceBrl = priceBrl ?: price
        this.feesBrl = feesBrl ?: fees
        this.date = date
        this.broker = broker
    }
}

fun createDividend(
    ticker: String,
    type: String = "DIVIDENDO",
    date: LocalDate = LocalDate.of(2024, 6, 15),
    totalAmount: Double = 100.0,
    taxWithheld: Double = 0.0,
    broker: String? = null,
    currency: String? = null,
    notes: String? = null,
    totalAmountBrl: Double? = null,
    taxWithheldBrl: Double? = null,
) = transaction {
    DividendEntity.new {
        this.assetId = ticker
        this.type = type
        this.date = date
        this.totalAmount = totalAmount
        this.taxWithheld = taxWithheld
        this.totalAmountBrl = totalAmountBrl ?: totalAmount
        this.taxWithheldBrl = taxWithheldBrl ?: taxWithheld
        this.broker = broker
        if (currency != null) this.currency = currency
        this.notes = notes
    }
}

fun createPriceHistory(
    ticker: String,
    date: LocalDate,
    close: Double,
) = transaction {
    PriceHistoryEntity.new {
        this.assetId = ticker
        this.date = date
        this.close = close
    }
}

fun createMonthlySnapshot(
    ticker: String,
    month: LocalDate,
    quantity: Double,
    avgPrice: Double,
    marketPrice: Double,
    totalCost: Double,
    marketValue: Double,
    accumulatedNetDividends: Double = 0.0,
) = transaction {
    MonthlySnapshotEntity.new {
        this.assetId = ticker
        this.month = month
        this.quantity = quantity
        this.avgPrice = avgPrice
        this.marketPrice = marketPrice
        this.totalCost = totalCost
        this.marketValue = marketValue
        this.accumulatedNetDividends = accumulatedNetDividends
    }
}

fun clearAllData() {
    transaction {
        MonthlySnapshotEntity.all().forEach { it.delete() }
        DividendEntity.all().forEach { it.delete() }
        TransactionEntity.all().forEach { it.delete() }
        PriceHistoryEntity.all().forEach { it.delete() }
        ExchangeRates.deleteAll()
        AssetEntity.all().forEach { it.delete() }
    }
}
