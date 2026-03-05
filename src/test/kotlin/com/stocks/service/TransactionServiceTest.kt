package com.stocks.service

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.mockk.mockk
import org.springframework.web.server.ResponseStatusException

// ==================== Unit Tests (no Spring) ====================

class ResolvePriceTest :
    FunSpec({
        val service = TransactionService(mockk())

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

class LookupTickerInfoTest :
    FunSpec({
        test("ticker too short returns NOT_FOUND") {
            val quoteService = mockk<QuoteService>()
            val service = TransactionService(quoteService)
            val result = service.lookupTickerInfo("AB")
            result.status shouldBe TickerLookupStatus.NOT_FOUND
            result.name.shouldBeNull()
        }
    })
