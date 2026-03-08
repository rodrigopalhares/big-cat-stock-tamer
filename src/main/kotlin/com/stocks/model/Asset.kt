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
    var createdAt by Assets.createdAt

    val transactions by TransactionEntity referrersOn Transactions.assetId
    val dividends by DividendEntity referrersOn Dividends.assetId
    val priceHistory by PriceHistoryEntity referrersOn PriceHistories.assetId
    val monthlySnapshots by MonthlySnapshotEntity referrersOn MonthlySnapshots.assetId
}
