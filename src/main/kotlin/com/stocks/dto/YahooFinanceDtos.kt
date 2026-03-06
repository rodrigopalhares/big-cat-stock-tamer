package com.stocks.dto

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

@JsonIgnoreProperties(ignoreUnknown = true)
data class YahooChartResponse(
    val chart: YahooChartData? = null
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class YahooChartData(
    val result: List<YahooChartResult>? = null,
    val error: Any? = null
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class YahooChartResult(
    val meta: YahooChartMeta? = null,
    val timestamp: List<Long>? = null,
    val indicators: YahooChartIndicators? = null
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class YahooChartMeta(
    val currency: String? = null,
    val symbol: String? = null,
    val regularMarketPrice: Double? = null,
    val longName: String? = null,
    val shortName: String? = null,
    val instrumentType: String? = null,
    val firstTradeDate: Long? = null
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class YahooChartIndicators(
    val quote: List<YahooChartQuote>? = null
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class YahooChartQuote(
    val close: List<Double?>? = null
)
