package com.stocks.dto

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

@JsonIgnoreProperties(ignoreUnknown = true)
data class BcbPtaxResponse(
    val value: List<BcbPtaxQuote> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class BcbPtaxQuote(
    val cotacaoCompra: Double,
    val cotacaoVenda: Double,
    val dataHoraCotacao: String,
)
