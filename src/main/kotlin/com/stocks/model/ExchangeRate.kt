package com.stocks.model

import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IntIdTable
import org.jetbrains.exposed.v1.dao.IntEntity
import org.jetbrains.exposed.v1.dao.IntEntityClass
import org.jetbrains.exposed.v1.javatime.date
import org.jetbrains.exposed.v1.javatime.datetime
import java.time.LocalDateTime

object ExchangeRates : IntIdTable("exchange_rates") {
    val date = date("date")
    val fromCurrency = varchar("from_currency", 10)
    val toCurrency = varchar("to_currency", 10)
    val buyRate = double("buy_rate")
    val sellRate = double("sell_rate")
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }

    init {
        uniqueIndex("uq_exchange_rate_date_pair", date, fromCurrency, toCurrency)
    }
}

class ExchangeRateEntity(
    id: EntityID<Int>,
) : IntEntity(id) {
    companion object : IntEntityClass<ExchangeRateEntity>(ExchangeRates)

    var date by ExchangeRates.date
    var fromCurrency by ExchangeRates.fromCurrency
    var toCurrency by ExchangeRates.toCurrency
    var buyRate by ExchangeRates.buyRate
    var sellRate by ExchangeRates.sellRate
    var createdAt by ExchangeRates.createdAt
}
