package com.stocks.model

import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IntIdTable
import org.jetbrains.exposed.v1.dao.IntEntity
import org.jetbrains.exposed.v1.dao.IntEntityClass
import org.jetbrains.exposed.v1.javatime.date
import org.jetbrains.exposed.v1.javatime.datetime
import java.time.LocalDateTime

object Transactions : IntIdTable("transactions") {
    val assetId = varchar("asset_id", 50).references(Assets.id)
    val type = varchar("type", 10)
    val quantity = double("quantity")
    val price = double("price")
    val fees = double("fees").default(0.0)
    val priceBrl = double("price_brl").default(0.0)
    val feesBrl = double("fees_brl").default(0.0)
    val date = date("date")
    val broker = varchar("broker", 255).nullable()
    val notes = text("notes").nullable()
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }
}

class TransactionEntity(
    id: EntityID<Int>
) : IntEntity(id) {
    companion object : IntEntityClass<TransactionEntity>(Transactions)

    var assetId by Transactions.assetId
    var type by Transactions.type
    var quantity by Transactions.quantity
    var price by Transactions.price
    var fees by Transactions.fees
    var priceBrl by Transactions.priceBrl
    var feesBrl by Transactions.feesBrl
    var date by Transactions.date
    var broker by Transactions.broker
    var notes by Transactions.notes
    var createdAt by Transactions.createdAt

    var asset by AssetEntity referencedOn Transactions.assetId
}
