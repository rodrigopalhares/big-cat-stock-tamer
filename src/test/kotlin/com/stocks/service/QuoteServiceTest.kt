package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.doubles.plusOrMinus

class QuoteServiceTest : FunSpec({

    test("exchange rate same currency returns 1.0") {
        val service = QuoteService()
        service.fetchExchangeRate("BRL", "BRL") shouldBe 1.0
    }

    test("fetch quotes batch empty tickers returns empty map") {
        val service = QuoteService()
        service.fetchQuotesBatch(emptyList()) shouldBe emptyMap()
    }

    test("fetch td quotes batch empty tickers returns empty map") {
        val service = QuoteService()
        service.fetchTdQuotesBatch(emptyList()) shouldBe emptyMap()
    }

    test("fetch historical quotes batch empty map returns empty map") {
        val service = QuoteService()
        service.fetchHistoricalQuotesBatch(emptyMap(), java.time.LocalDate.now()) shouldBe emptyMap()
    }

    test("fetch td historical quotes batch empty list returns empty map") {
        val service = QuoteService()
        service.fetchTdHistoricalQuotesBatch(emptyList()) shouldBe emptyMap()
    }
})
