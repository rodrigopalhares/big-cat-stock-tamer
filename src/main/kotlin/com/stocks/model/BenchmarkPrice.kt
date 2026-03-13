package com.stocks.model

import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IntIdTable
import org.jetbrains.exposed.v1.dao.IntEntity
import org.jetbrains.exposed.v1.dao.IntEntityClass
import org.jetbrains.exposed.v1.javatime.date
import org.jetbrains.exposed.v1.javatime.datetime
import java.time.LocalDateTime

object BenchmarkPrices : IntIdTable("benchmark_prices") {
    val ticker = varchar("ticker", 20)
    val month = date("month")
    val close = double("close")
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }

    init {
        uniqueIndex("uq_benchmark_ticker_month", ticker, month)
    }
}

class BenchmarkPriceEntity(
    id: EntityID<Int>,
) : IntEntity(id) {
    companion object : IntEntityClass<BenchmarkPriceEntity>(BenchmarkPrices)

    var ticker by BenchmarkPrices.ticker
    var month by BenchmarkPrices.month
    var close by BenchmarkPrices.close
    var createdAt by BenchmarkPrices.createdAt
}
