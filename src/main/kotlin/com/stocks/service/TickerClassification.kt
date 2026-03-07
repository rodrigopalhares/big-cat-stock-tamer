package com.stocks.service

data class TickerClassification(
    val suggestedType: String?,
    val yfCandidates: List<String>,
    val defaultCurrency: String,
)

private val fiiOrEtfPattern = Regex("^[A-Z]{4,6}11$")
private val bdrPattern = Regex("^[A-Z]{4}3[4-9]$")
private val brStockPattern = Regex("^[A-Z]{4}\\d{1,2}$")
private val internationalPattern = Regex("^[A-Z]{1,5}$")

fun classifyTicker(ticker: String): TickerClassification =
    when {
        ";" in ticker ->
            TickerClassification(
                suggestedType = "TESOURO_DIRETO",
                yfCandidates = listOf(ticker),
                defaultCurrency = "BRL",
            )

        "." in ticker ->
            TickerClassification(
                suggestedType = "INTERNATIONAL",
                yfCandidates = listOf(ticker),
                defaultCurrency = "USD",
            )

        "-" in ticker && ticker.substringAfter("-").let { it == "USD" || it == "BRL" || it == "EUR" } ->
            TickerClassification(
                suggestedType = "CRYPTO",
                yfCandidates = listOf(ticker),
                defaultCurrency = "USD",
            )

        fiiOrEtfPattern.matches(ticker) ->
            TickerClassification(
                suggestedType = null,
                yfCandidates = listOf("$ticker.SA"),
                defaultCurrency = "BRL",
            )

        bdrPattern.matches(ticker) ->
            TickerClassification(
                suggestedType = "BDR",
                yfCandidates = listOf("$ticker.SA"),
                defaultCurrency = "BRL",
            )

        brStockPattern.matches(ticker) ->
            TickerClassification(
                suggestedType = "STOCK",
                yfCandidates = listOf("$ticker.SA"),
                defaultCurrency = "BRL",
            )

        internationalPattern.matches(ticker) ->
            TickerClassification(
                suggestedType = "INTERNATIONAL",
                yfCandidates = listOf(ticker, "$ticker.SA"),
                defaultCurrency = "USD",
            )

        else ->
            TickerClassification(
                suggestedType = null,
                yfCandidates = listOf("$ticker.SA", ticker),
                defaultCurrency = "BRL",
            )
    }
