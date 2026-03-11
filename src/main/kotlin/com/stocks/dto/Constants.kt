package com.stocks.dto

val ASSET_TYPES = listOf("STOCK", "REIT", "ETF", "BDR", "TESOURO_DIRETO", "CRYPTO", "INTERNATIONAL", "RENDA_FIXA", "OUTROS")
val NO_QUOTE_TYPES = setOf("RENDA_FIXA", "OUTROS")
val DIVIDEND_TYPES = listOf("DIVIDENDO", "JCP", "RENDIMENTO", "BONIFICACAO", "BTC")
val VALID_CURRENCIES = listOf("BRL", "USD")

val DIVIDEND_TYPE_ALIASES =
    mapOf(
        "DIVIDENDO" to "DIVIDENDO",
        "DIVIDENDOS" to "DIVIDENDO",
        "DIV" to "DIVIDENDO",
        "REEMBOLSO(DIV)" to "DIVIDENDO",
        "JCP" to "JCP",
        "JSCP" to "JCP",
        "JUROS SOBRE CAPITAL PROPRIO" to "JCP",
        "JUROS SOBRE CAPITAL" to "JCP",
        "JUROS S/ CAPITAL" to "JCP",
        "RENDIMENTO" to "RENDIMENTO",
        "RENDIMENTOS" to "RENDIMENTO",
        "REND" to "RENDIMENTO",
        "BONIFICACAO" to "BONIFICACAO",
        "BONIFICAÇÃO" to "BONIFICACAO",
        "BTC" to "BTC",
    )
