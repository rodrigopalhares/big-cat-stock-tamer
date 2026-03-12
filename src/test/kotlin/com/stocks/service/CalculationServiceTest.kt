package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import java.time.LocalDate

class CalculationServiceTest :
    FunSpec({

        val service = CalculationService()

        // --- calculatePosition ---

        test("single buy") {
            val txs = listOf(TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 1)))
            val result = service.calculatePosition(txs)
            result.quantity shouldBe (10.0 plusOrMinus 0.001)
            result.avgPrice shouldBe (10.0 plusOrMinus 0.001)
            result.totalCost shouldBe (100.0 plusOrMinus 0.001)
            result.realizedPnl shouldBe (0.0 plusOrMinus 0.001)
        }

        test("buy with fees") {
            val txs = listOf(TransactionData("BUY", 10.0, 10.0, 5.0, LocalDate.of(2024, 1, 1)))
            val result = service.calculatePosition(txs)
            result.avgPrice shouldBe (10.5 plusOrMinus 0.001)
            result.totalCost shouldBe (105.0 plusOrMinus 0.001)
        }

        test("two buys weighted average") {
            val txs =
                listOf(
                    TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 1)),
                    TransactionData("BUY", 10.0, 20.0, 0.0, LocalDate.of(2024, 1, 2)),
                )
            val result = service.calculatePosition(txs)
            result.avgPrice shouldBe (15.0 plusOrMinus 0.001)
            result.quantity shouldBe (20.0 plusOrMinus 0.001)
        }

        test("buy then sell profit") {
            val txs =
                listOf(
                    TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 1)),
                    TransactionData("SELL", -10.0, 15.0, 0.0, LocalDate.of(2024, 1, 2)),
                )
            val result = service.calculatePosition(txs)
            result.realizedPnl shouldBe (50.0 plusOrMinus 0.001)
            result.quantity shouldBe (0.0 plusOrMinus 0.001)
        }

        test("buy then sell loss") {
            val txs =
                listOf(
                    TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 1)),
                    TransactionData("SELL", -10.0, 8.0, 0.0, LocalDate.of(2024, 1, 2)),
                )
            val result = service.calculatePosition(txs)
            result.realizedPnl shouldBe (-20.0 plusOrMinus 0.001)
        }

        test("sell without buy") {
            val txs = listOf(TransactionData("SELL", -10.0, 15.0, 0.0, LocalDate.of(2024, 1, 1)))
            val result = service.calculatePosition(txs)
            result.quantity shouldBe (0.0 plusOrMinus 0.001)
            result.realizedPnl shouldBe (0.0 plusOrMinus 0.001)
        }

        test("empty list") {
            val result = service.calculatePosition(emptyList())
            result.quantity shouldBe 0.0
            result.avgPrice shouldBe 0.0
            result.totalCost shouldBe 0.0
            result.realizedPnl shouldBe 0.0
        }

        test("avgPriceBrl uses priceBrl values") {
            val txs =
                listOf(
                    TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 1), priceBrl = 50.0),
                    TransactionData("BUY", 10.0, 20.0, 0.0, LocalDate.of(2024, 1, 2), priceBrl = 110.0),
                )
            val result = service.calculatePosition(txs)
            result.avgPrice shouldBe (15.0 plusOrMinus 0.001)
            result.avgPriceBrl shouldBe (80.0 plusOrMinus 0.001) // (500 + 1100) / 20
            result.totalCostBrl shouldBe (1600.0 plusOrMinus 0.001)
        }

        test("cash flows signs") {
            val txs =
                listOf(
                    TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 1)),
                    TransactionData("SELL", -5.0, 15.0, 0.0, LocalDate.of(2024, 1, 2)),
                )
            val result = service.calculatePosition(txs)
            result.cashFlows.size shouldBe 2
            (result.cashFlows[0].second < 0) shouldBe true
            (result.cashFlows[1].second > 0) shouldBe true
        }

        // --- calculateUnrealizedPnl ---

        test("unrealized pnl profit") {
            service.calculateUnrealizedPnl(10.0, 10.0, 15.0) shouldBe (50.0 plusOrMinus 0.001)
        }

        test("unrealized pnl loss") {
            service.calculateUnrealizedPnl(10.0, 10.0, 8.0) shouldBe (-20.0 plusOrMinus 0.001)
        }

        test("unrealized pnl breakeven") {
            service.calculateUnrealizedPnl(10.0, 10.0, 10.0) shouldBe (0.0 plusOrMinus 0.001)
        }

        // --- calculateIrr ---

        test("irr empty flows") {
            service.calculateIrr(emptyList()).shouldBeNull()
        }

        test("irr single flow") {
            service.calculateIrr(listOf(LocalDate.of(2024, 1, 1) to -100.0)).shouldBeNull()
        }

        test("irr valid flows") {
            val flows =
                listOf(
                    LocalDate.of(2024, 1, 1) to -100.0,
                    LocalDate.of(2024, 6, 1) to 120.0,
                )
            val result = service.calculateIrr(flows)
            result.shouldNotBeNull()
            result.shouldBeInstanceOf<Double>()
        }

        test("irr with current value appended") {
            val flows = listOf(LocalDate.of(2024, 1, 1) to -100.0)
            service.calculateIrr(flows).shouldBeNull()
            service.calculateIrr(flows, currentValue = 120.0).shouldNotBeNull()
        }

        // --- calculateXirr ---

        test("xirr empty flows") {
            service.calculateXirr(emptyList()).shouldBeNull()
        }

        test("xirr single flow") {
            service.calculateXirr(listOf(LocalDate.of(2024, 1, 1) to -100.0)).shouldBeNull()
        }

        test("xirr all negative") {
            val flows =
                listOf(
                    LocalDate.of(2024, 1, 1) to -100.0,
                    LocalDate.of(2024, 2, 1) to -50.0,
                )
            service.calculateXirr(flows).shouldBeNull()
        }

        test("xirr all positive") {
            val flows =
                listOf(
                    LocalDate.of(2024, 1, 1) to 100.0,
                    LocalDate.of(2024, 2, 1) to 50.0,
                )
            service.calculateXirr(flows).shouldBeNull()
        }

        test("xirr valid buy and sell") {
            val flows =
                listOf(
                    LocalDate.of(2024, 1, 1) to -1000.0,
                    LocalDate.of(2025, 1, 1) to 1200.0,
                )
            val result = service.calculateXirr(flows)
            result.shouldNotBeNull()
            result.shouldBeInstanceOf<Double>()
            (result > 0) shouldBe true
        }
    })
