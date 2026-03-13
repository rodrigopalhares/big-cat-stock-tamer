package com.stocks.model

import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IntIdTable
import org.jetbrains.exposed.v1.dao.IntEntity
import org.jetbrains.exposed.v1.dao.IntEntityClass
import org.jetbrains.exposed.v1.javatime.date
import org.jetbrains.exposed.v1.javatime.datetime
import java.time.LocalDateTime

object RiskMetrics : IntIdTable("risk_metrics") {
    val ticker = varchar("ticker", 20)
    val calculatedAt = date("calculated_at")
    val beta = double("beta").nullable()
    val alpha = double("alpha").nullable()
    val rSquared = double("r_squared").nullable()
    val dataPoints = integer("data_points")
    val cdiAnnual = double("cdi_annual").nullable()
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }

    init {
        uniqueIndex("uq_risk_metrics_ticker_date", ticker, calculatedAt)
    }
}

class RiskMetricEntity(
    id: EntityID<Int>,
) : IntEntity(id) {
    companion object : IntEntityClass<RiskMetricEntity>(RiskMetrics)

    var ticker by RiskMetrics.ticker
    var calculatedAt by RiskMetrics.calculatedAt
    var beta by RiskMetrics.beta
    var alpha by RiskMetrics.alpha
    var rSquared by RiskMetrics.rSquared
    var dataPoints by RiskMetrics.dataPoints
    var cdiAnnual by RiskMetrics.cdiAnnual
    var createdAt by RiskMetrics.createdAt
}
