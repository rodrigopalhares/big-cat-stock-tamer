package com.stocks.dto

enum class AssetStatus {
    EXISTS,
    WILL_CREATE,
    UNKNOWN,
}

data class CsvAssetRow(
    val ticker: String,
    val name: String,
    val type: String,
    val yfTicker: String,
    val currency: String,
    val assetStatus: AssetStatus,
)

data class AssetBatchRow(
    val ticker: String,
    val name: String,
    val type: String,
    val yfTicker: String,
    val currency: String,
)

data class CsvRow(
    val rowIndex: Int,
    val ticker: String,
    val date: String,
    val type: String,
    val quantity: Double,
    val price: Double,
    val fees: Double,
    val broker: String,
    val notes: String,
    val currency: String,
    val assetStatus: AssetStatus,
    val error: String? = null,
)

data class BatchRequest(
    val rows: List<BatchRowRequest>,
)

data class BatchRowRequest(
    val ticker: String,
    val date: String,
    val type: String,
    val quantity: Double,
    val price: Double,
    val fees: Double,
    val broker: String,
    val notes: String,
    val currency: String,
)

data class DividendCsvRow(
    val rowIndex: Int,
    val ticker: String,
    val date: String,
    val type: String,
    val totalAmount: Double,
    val taxWithheld: Double,
    val currency: String,
    val broker: String,
    val notes: String,
    val error: String? = null,
)

data class DividendBatchRequest(
    val rows: List<DividendBatchRowRequest>,
)

data class DividendBatchRowRequest(
    val ticker: String,
    val date: String,
    val type: String,
    val totalAmount: Double,
    val taxWithheld: Double,
    val currency: String,
    val broker: String,
    val notes: String,
)
