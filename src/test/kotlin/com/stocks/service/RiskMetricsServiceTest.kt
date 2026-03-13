package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.LocalDate

class RiskMetricsServiceTest :
    FunSpec({

        // --- linearRegression ---

        test("linear regression with perfect positive correlation") {
            val x = listOf(1.0, 2.0, 3.0, 4.0, 5.0)
            val y = listOf(2.0, 4.0, 6.0, 8.0, 10.0) // y = 2x
            val result = RiskMetricsService.linearRegression(x, y)
            result.shouldNotBeNull()
            result.beta shouldBe (2.0 plusOrMinus 0.001)
            result.alpha shouldBe (0.0 plusOrMinus 0.001)
            result.rSquared shouldBe (1.0 plusOrMinus 0.001)
            result.dataPoints shouldBe 5
        }

        test("linear regression with offset") {
            val x = listOf(1.0, 2.0, 3.0, 4.0, 5.0)
            val y = listOf(3.0, 5.0, 7.0, 9.0, 11.0) // y = 2x + 1
            val result = RiskMetricsService.linearRegression(x, y)
            result.shouldNotBeNull()
            result.beta shouldBe (2.0 plusOrMinus 0.001)
            result.alpha shouldBe (1.0 plusOrMinus 0.001)
            result.rSquared shouldBe (1.0 plusOrMinus 0.001)
        }

        test("linear regression with no correlation") {
            val x = listOf(1.0, 2.0, 3.0, 4.0, 5.0)
            val y = listOf(5.0, 5.0, 5.0, 5.0, 5.0) // constant
            val result = RiskMetricsService.linearRegression(x, y)
            result.shouldNotBeNull()
            result.beta shouldBe (0.0 plusOrMinus 0.001)
            result.rSquared shouldBe (0.0 plusOrMinus 0.001)
        }

        test("linear regression with insufficient data") {
            val result = RiskMetricsService.linearRegression(listOf(1.0), listOf(2.0))
            result.shouldBeNull()
        }

        test("linear regression with empty data") {
            val result = RiskMetricsService.linearRegression(emptyList(), emptyList())
            result.shouldBeNull()
        }

        test("linear regression with zero variance in x") {
            val x = listOf(3.0, 3.0, 3.0)
            val y = listOf(1.0, 2.0, 3.0)
            val result = RiskMetricsService.linearRegression(x, y)
            result.shouldBeNull()
        }

        test("linear regression with negative correlation") {
            val x = listOf(1.0, 2.0, 3.0, 4.0, 5.0)
            val y = listOf(10.0, 8.0, 6.0, 4.0, 2.0) // y = -2x + 12
            val result = RiskMetricsService.linearRegression(x, y)
            result.shouldNotBeNull()
            result.beta shouldBe (-2.0 plusOrMinus 0.001)
            result.rSquared shouldBe (1.0 plusOrMinus 0.001)
        }

        test("linear regression with partial correlation") {
            val x = listOf(1.0, 2.0, 3.0, 4.0, 5.0)
            val y = listOf(2.1, 3.8, 6.2, 7.9, 10.1) // approximately y = 2x with noise
            val result = RiskMetricsService.linearRegression(x, y)
            result.shouldNotBeNull()
            result.beta shouldBe (1.99 plusOrMinus 0.1)
            (result.rSquared > 0.99) shouldBe true
            result.dataPoints shouldBe 5
        }

        // --- computeMonthlyReturns ---

        test("monthly returns from price series") {
            val prices =
                mapOf(
                    LocalDate.of(2024, 1, 1) to 100.0,
                    LocalDate.of(2024, 2, 1) to 110.0,
                    LocalDate.of(2024, 3, 1) to 105.0,
                )
            val cutoff = LocalDate.of(2024, 1, 1)
            val returns = RiskMetricsService.computeMonthlyReturns(prices, cutoff)

            returns.size shouldBe 2
            returns[LocalDate.of(2024, 2, 1)] shouldBe (0.10 plusOrMinus 0.001) // 10%
            returns[LocalDate.of(2024, 3, 1)] shouldBe (-0.04545 plusOrMinus 0.001) // -4.5%
        }

        test("monthly returns with cutoff filters old data") {
            val prices =
                mapOf(
                    LocalDate.of(2023, 12, 1) to 90.0,
                    LocalDate.of(2024, 1, 1) to 100.0,
                    LocalDate.of(2024, 2, 1) to 110.0,
                )
            val cutoff = LocalDate.of(2024, 1, 1)
            val returns = RiskMetricsService.computeMonthlyReturns(prices, cutoff)

            returns.size shouldBe 1
            returns[LocalDate.of(2024, 2, 1)] shouldBe (0.10 plusOrMinus 0.001)
        }

        test("monthly returns with single price returns empty") {
            val prices = mapOf(LocalDate.of(2024, 1, 1) to 100.0)
            val returns = RiskMetricsService.computeMonthlyReturns(prices, LocalDate.of(2024, 1, 1))
            returns shouldBe emptyMap()
        }

        test("monthly returns with empty prices") {
            val returns = RiskMetricsService.computeMonthlyReturns(emptyMap(), LocalDate.of(2024, 1, 1))
            returns shouldBe emptyMap()
        }

        test("monthly returns skips zero previous price") {
            val prices =
                mapOf(
                    LocalDate.of(2024, 1, 1) to 0.0,
                    LocalDate.of(2024, 2, 1) to 100.0,
                )
            val returns = RiskMetricsService.computeMonthlyReturns(prices, LocalDate.of(2024, 1, 1))
            returns shouldBe emptyMap()
        }
    })
