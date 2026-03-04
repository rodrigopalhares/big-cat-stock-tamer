package com.stocks.model

import org.jetbrains.exposed.dao.IntEntity
import org.jetbrains.exposed.dao.IntEntityClass
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.dao.id.IntIdTable
import org.jetbrains.exposed.sql.javatime.date
import org.jetbrains.exposed.sql.javatime.datetime
import java.time.LocalDateTime

object PriceHistories : IntIdTable("price_history") {
    val assetId = varchar("asset_id", 50).references(Assets.id)
    val date = date("date")
    val close = double("close")
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }

    init {
        uniqueIndex("uq_price_history_asset_date", assetId, date)
    }
}

class PriceHistoryEntity(id: EntityID<Int>) : IntEntity(id) {
    companion object : IntEntityClass<PriceHistoryEntity>(PriceHistories)

    var assetId by PriceHistories.assetId
    var date by PriceHistories.date
    var close by PriceHistories.close
    var createdAt by PriceHistories.createdAt

    var asset by AssetEntity referencedOn PriceHistories.assetId
}
