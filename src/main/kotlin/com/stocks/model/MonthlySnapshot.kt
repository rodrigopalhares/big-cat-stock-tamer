package com.stocks.model

import org.jetbrains.exposed.dao.IntEntity
import org.jetbrains.exposed.dao.IntEntityClass
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.dao.id.IntIdTable
import org.jetbrains.exposed.sql.javatime.date
import org.jetbrains.exposed.sql.javatime.datetime
import java.time.LocalDateTime

object MonthlySnapshots : IntIdTable("monthly_snapshots") {
    val assetId = varchar("asset_id", 50).references(Assets.id)
    val month = date("month")
    val quantity = double("quantity")
    val avgPrice = double("avg_price")
    val marketPrice = double("market_price")
    val totalCost = double("total_cost")
    val marketValue = double("market_value")
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }

    init {
        uniqueIndex("uq_monthly_snapshot_asset_month", assetId, month)
    }
}

class MonthlySnapshotEntity(
    id: EntityID<Int>,
) : IntEntity(id) {
    companion object : IntEntityClass<MonthlySnapshotEntity>(MonthlySnapshots)

    var assetId by MonthlySnapshots.assetId
    var month by MonthlySnapshots.month
    var quantity by MonthlySnapshots.quantity
    var avgPrice by MonthlySnapshots.avgPrice
    var marketPrice by MonthlySnapshots.marketPrice
    var totalCost by MonthlySnapshots.totalCost
    var marketValue by MonthlySnapshots.marketValue
    var createdAt by MonthlySnapshots.createdAt

    var asset by AssetEntity referencedOn MonthlySnapshots.assetId
}
