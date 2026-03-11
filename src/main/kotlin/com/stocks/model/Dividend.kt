package com.stocks.model

import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IntIdTable
import org.jetbrains.exposed.v1.dao.IntEntity
import org.jetbrains.exposed.v1.dao.IntEntityClass
import org.jetbrains.exposed.v1.javatime.date
import org.jetbrains.exposed.v1.javatime.datetime
import java.time.LocalDateTime

object Dividends : IntIdTable("dividends") {
    val assetId = varchar("asset_id", 50).references(Assets.id)
    val type = varchar("type", 20)
    val date = date("date")
    val totalAmount = double("total_amount")
    val taxWithheld = double("tax_withheld").default(0.0)
    val totalAmountBrl = double("total_amount_brl").default(0.0)
    val taxWithheldBrl = double("tax_withheld_brl").default(0.0)
    val broker = varchar("broker", 100).nullable()
    val currency = varchar("currency", 10).default("BRL")
    val notes = text("notes").nullable()
    val createdAt = datetime("created_at").clientDefault { LocalDateTime.now() }
}

class DividendEntity(
    id: EntityID<Int>,
) : IntEntity(id) {
    companion object : IntEntityClass<DividendEntity>(Dividends)

    var assetId by Dividends.assetId
    var type by Dividends.type
    var date by Dividends.date
    var totalAmount by Dividends.totalAmount
    var taxWithheld by Dividends.taxWithheld
    var totalAmountBrl by Dividends.totalAmountBrl
    var taxWithheldBrl by Dividends.taxWithheldBrl
    var broker by Dividends.broker
    var currency by Dividends.currency
    var notes by Dividends.notes
    var createdAt by Dividends.createdAt

    var asset by AssetEntity referencedOn Dividends.assetId
}
