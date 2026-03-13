package com.stocks.service

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import org.springframework.web.server.ResponseStatusException
import java.time.LocalDate

// ==================== Unit Tests (no Spring) ====================

class ResolvePriceTest :
    FunSpec({
        val service = TransactionService(mockk(), mockk())

        test("price and fees provided directly") {
            val result = service.resolvePrice(price = 10.0, totalPrice = null, fees = 1.0, quantity = 5.0)
            result.price shouldBe (10.0 plusOrMinus 0.001)
            result.fees shouldBe (1.0 plusOrMinus 0.001)
        }

        test("totalPrice with unit price calculates fees") {
            // total = 55, qty * price = 5 * 10 = 50 → fees = 5
            val result = service.resolvePrice(price = 10.0, totalPrice = 55.0, fees = 0.0, quantity = 5.0)
            result.price shouldBe (10.0 plusOrMinus 0.001)
            result.fees shouldBe (5.0 plusOrMinus 0.001)
        }

        test("totalPrice without unit price calculates price") {
            // total = 55, fees = 5 → price = (55 - 5) / 5 = 10
            val result = service.resolvePrice(price = null, totalPrice = 55.0, fees = 5.0, quantity = 5.0)
            result.price shouldBe (10.0 plusOrMinus 0.001)
            result.fees shouldBe (5.0 plusOrMinus 0.001)
        }

        test("no price and no totalPrice throws bad request") {
            shouldThrow<ResponseStatusException> {
                service.resolvePrice(price = null, totalPrice = null, fees = 0.0, quantity = 5.0)
            }
        }

        test("zero price and no totalPrice throws bad request") {
            shouldThrow<ResponseStatusException> {
                service.resolvePrice(price = 0.0, totalPrice = null, fees = 0.0, quantity = 5.0)
            }
        }
    })

class ConvertPricesTest :
    FunSpec({
        val exchangeRateService = mockk<ExchangeRateService>()
        val service = TransactionService(mockk(), exchangeRateService)
        val date = LocalDate.of(2024, 6, 1)

        beforeEach {
            every { exchangeRateService.getRate("USD", "BRL", date) } returns 5.0
        }

        test("same currency BRL - no conversion needed") {
            val result = service.convertPrices(100.0, 10.0, "BRL", "BRL", date)
            result.price shouldBe (100.0 plusOrMinus 0.001)
            result.fees shouldBe (10.0 plusOrMinus 0.001)
            result.priceBrl shouldBe (100.0 plusOrMinus 0.001)
            result.feesBrl shouldBe (10.0 plusOrMinus 0.001)
        }

        test("same currency USD - converts to BRL") {
            val result = service.convertPrices(20.0, 1.0, "USD", "USD", date)
            result.price shouldBe (20.0 plusOrMinus 0.001)
            result.fees shouldBe (1.0 plusOrMinus 0.001)
            result.priceBrl shouldBe (100.0 plusOrMinus 0.001)
            result.feesBrl shouldBe (5.0 plusOrMinus 0.001)
        }

        test("input BRL for USD asset - divides by rate") {
            // User enters 100 BRL for a USD asset, rate USD->BRL = 5.0
            // price in USD = 100 / 5 = 20
            val result = service.convertPrices(100.0, 5.0, "BRL", "USD", date)
            result.price shouldBe (20.0 plusOrMinus 0.001)
            result.fees shouldBe (1.0 plusOrMinus 0.001)
            result.priceBrl shouldBe (100.0 plusOrMinus 0.001)
            result.feesBrl shouldBe (5.0 plusOrMinus 0.001)
        }

        test("input USD for BRL asset - multiplies by rate") {
            // User enters 20 USD for a BRL asset, rate USD->BRL = 5.0
            // price in BRL = 20 * 5 = 100
            val result = service.convertPrices(20.0, 1.0, "USD", "BRL", date)
            result.price shouldBe (100.0 plusOrMinus 0.001)
            result.fees shouldBe (5.0 plusOrMinus 0.001)
            result.priceBrl shouldBe (100.0 plusOrMinus 0.001)
            result.feesBrl shouldBe (5.0 plusOrMinus 0.001)
        }
    })

class LookupTickerInfoTest :
    FunSpec({
        test("ticker too short returns NOT_FOUND") {
            val quoteService = mockk<QuoteService>()
            val service = TransactionService(quoteService, mockk())
            val result = service.lookupTickerInfo("AB")
            result.status shouldBe TickerLookupStatus.NOT_FOUND
            result.name.shouldBeNull()
        }
    })
