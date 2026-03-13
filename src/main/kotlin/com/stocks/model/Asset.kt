package com.stocks.model

import org.jetbrains.exposed.v1.core.Column
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IdTable
import org.jetbrains.exposed.v1.dao.Entity
import org.jetbrains.exposed.v1.dao.EntityClass
import org.jetbrains.exposed.v1.javatime.datetime
import java.time.LocalDateTime

object Assets : IdTable<String>("assets") {
    override val id: Column<EntityID<String>> = varchar("ticker", 50).entityId()
    val yfTicker = varchar("yf_ticker", 100).nullable()
    val name = varchar("name", 255).nullable()
    val type = varchar("type", 50).nullable()
    val currency = varchar("currency", 10).default("BRL")
    val delisted = bool("delisted").default(false)
    val hasPosition = bool("has_position").default(false)
    val quantity = double("quantity").default(0.0)
    val avgPrice = double("avg_price").default(0.0)
    val avgPriceBrl = double("avg_price_brl").default(0.0)
    val totalCost = double("total_cost").default(0.0)
    val totalCostBrl = double("total_cost_brl").default(0.0)
    val realizedPnl = double("realized_pnl").default(0.0)
    val realizedPnlBrl = double("realized_pnl_brl").default(0.0)
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }

    override val primaryKey = PrimaryKey(id)
}

class AssetEntity(
    id: EntityID<String>
) : Entity<String>(id) {
    companion object : EntityClass<String, AssetEntity>(Assets)

    var ticker by Assets.id
    var yfTicker by Assets.yfTicker
    var name by Assets.name
    var type by Assets.type
    var currency by Assets.currency
    var delisted by Assets.delisted
    var hasPosition by Assets.hasPosition
    var quantity by Assets.quantity
    var avgPrice by Assets.avgPrice
    var avgPriceBrl by Assets.avgPriceBrl
    var totalCost by Assets.totalCost
    var totalCostBrl by Assets.totalCostBrl
    var realizedPnl by Assets.realizedPnl
    var realizedPnlBrl by Assets.realizedPnlBrl
    var createdAt by Assets.createdAt

    val transactions by TransactionEntity referrersOn Transactions.assetId
    val dividends by DividendEntity referrersOn Dividends.assetId
    val priceHistory by PriceHistoryEntity referrersOn PriceHistories.assetId
    val monthlySnapshots by MonthlySnapshotEntity referrersOn MonthlySnapshots.assetId
}
