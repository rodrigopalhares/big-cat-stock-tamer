package com.stocks.service

import com.ninjasquad.springmockk.MockkBean
import com.stocks.model.*
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.mockk.every
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.context.ActiveProfiles
import java.time.LocalDate
import java.time.YearMonth

@ApplyExtension(SpringExtension::class)
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MonthlyEvolutionServiceTest(
    private val monthlyEvolutionService: MonthlyEvolutionService,
    @MockkBean private val quoteService: QuoteService,
) : FunSpec({

        beforeEach {
            every { quoteService.fetchHistoricalQuotesBatch(any(), any()) } returns emptyMap()
            every { quoteService.fetchTdHistoricalQuotesBatch(any()) } returns emptyMap()
            transaction {
                MonthlySnapshotEntity.all().forEach { it.delete() }
                DividendEntity.all().forEach { it.delete() }
                TransactionEntity.all().forEach { it.delete() }
                PriceHistoryEntity.all().forEach { it.delete() }
                AssetEntity.all().forEach { it.delete() }
            }
        }

        // --- generateMonthRange ---

        test("generateMonthRange single month") {
            val range =
                monthlyEvolutionService.generateMonthRange(
                    YearMonth.of(2024, 1),
                    YearMonth.of(2024, 1),
                )
            range shouldHaveSize 1
            range[0] shouldBe YearMonth.of(2024, 1)
        }

        test("generateMonthRange multiple months") {
            val range =
                monthlyEvolutionService.generateMonthRange(
                    YearMonth.of(2024, 1),
                    YearMonth.of(2024, 4),
                )
            range shouldHaveSize 4
            range[0] shouldBe YearMonth.of(2024, 1)
            range[3] shouldBe YearMonth.of(2024, 4)
        }

        // --- computePositionAtDate ---

        test("computePositionAtDate filters transactions up to date") {
            val txs =
                listOf(
                    TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 15)),
                    TransactionData("BUY", 5.0, 20.0, 0.0, LocalDate.of(2024, 3, 10)),
                )
            val result = monthlyEvolutionService.computePositionAtDate(txs, LocalDate.of(2024, 1, 31))
            result.quantity shouldBe (10.0 plusOrMinus 0.001)
            result.avgPrice shouldBe (10.0 plusOrMinus 0.001)
        }

        test("computePositionAtDate includes all transactions on or before date") {
            val txs =
                listOf(
                    TransactionData("BUY", 10.0, 10.0, 0.0, LocalDate.of(2024, 1, 15)),
                    TransactionData("BUY", 10.0, 20.0, 0.0, LocalDate.of(2024, 2, 28)),
                )
            val result = monthlyEvolutionService.computePositionAtDate(txs, LocalDate.of(2024, 2, 29))
            result.quantity shouldBe (20.0 plusOrMinus 0.001)
            result.avgPrice shouldBe (15.0 plusOrMinus 0.001)
        }

        // --- findFirstTransactionMonth ---

        test("findFirstTransactionMonth returns null when no transactions") {
            monthlyEvolutionService.findFirstTransactionMonth().shouldBeNull()
        }

        test("findFirstTransactionMonth returns correct month") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 10.0
                    fees = 0.0
                    date = LocalDate.of(2024, 3, 15)
                }
            }
            monthlyEvolutionService.findFirstTransactionMonth() shouldBe YearMonth.of(2024, 3)
        }

        test("findFirstTransactionMonth returns earliest across assets") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                AssetEntity.new("VALE3") {
                    name = "Vale"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 10.0
                    fees = 0.0
                    date = LocalDate.of(2024, 5, 1)
                }
                TransactionEntity.new {
                    assetId = "VALE3"
                    type = "BUY"
                    quantity = 10.0
                    price = 50.0
                    fees = 0.0
                    date = LocalDate.of(2024, 2, 10)
                }
            }
            monthlyEvolutionService.findFirstTransactionMonth() shouldBe YearMonth.of(2024, 2)
        }

        // --- getMonthEndPrice ---

        test("getMonthEndPrice returns null when no prices") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }
            monthlyEvolutionService.getMonthEndPrice("PETR4", LocalDate.of(2024, 1, 31)).shouldBeNull()
        }

        test("getMonthEndPrice returns latest price on or before date") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 15)
                    close = 30.0
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 2, 5)
                    close = 35.0
                }
            }
            monthlyEvolutionService.getMonthEndPrice("PETR4", LocalDate.of(2024, 1, 31)) shouldBe (32.0 plusOrMinus 0.001)
        }

        test("getMonthEndPrice ignores prices after date") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 2, 5)
                    close = 35.0
                }
            }
            monthlyEvolutionService.getMonthEndPrice("PETR4", LocalDate.of(2024, 1, 31)).shouldBeNull()
        }

        // --- recalculate ---

        test("recalculate single asset single month") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
            }

            monthlyEvolutionService.recalculate()

            val snapshots = transaction { MonthlySnapshotEntity.all().toList() }
            snapshots.shouldNotBeNull()
            // At least the January 2024 snapshot should exist
            val janSnapshot =
                snapshots.find {
                    it.assetId == "PETR4" && it.month == LocalDate.of(2024, 1, 1)
                }
            janSnapshot.shouldNotBeNull()
            janSnapshot.quantity shouldBe (10.0 plusOrMinus 0.001)
            janSnapshot.avgPrice shouldBe (30.0 plusOrMinus 0.001)
            janSnapshot.marketPrice shouldBe (32.0 plusOrMinus 0.001)
            janSnapshot.totalCost shouldBe (300.0 plusOrMinus 0.001)
            janSnapshot.marketValue shouldBe (320.0 plusOrMinus 0.001)
        }

        test("recalculate multiple months") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 2, 28)
                    close = 35.0
                }
            }

            monthlyEvolutionService.recalculate()

            val snapshots =
                transaction {
                    MonthlySnapshotEntity.all().toList().filter { it.assetId == "PETR4" }
                }
            val janSnapshot = snapshots.find { it.month == LocalDate.of(2024, 1, 1) }
            val febSnapshot = snapshots.find { it.month == LocalDate.of(2024, 2, 1) }

            janSnapshot.shouldNotBeNull()
            janSnapshot.marketPrice shouldBe (32.0 plusOrMinus 0.001)

            febSnapshot.shouldNotBeNull()
            febSnapshot.quantity shouldBe (10.0 plusOrMinus 0.001)
            febSnapshot.marketPrice shouldBe (35.0 plusOrMinus 0.001)
            febSnapshot.marketValue shouldBe (350.0 plusOrMinus 0.001)
        }

        test("recalculate buy then sell reduces quantity") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "SELL"
                    quantity = 5.0
                    price = 35.0
                    fees = 0.0
                    date = LocalDate.of(2024, 2, 10)
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 2, 28)
                    close = 36.0
                }
            }

            monthlyEvolutionService.recalculate()

            val febSnapshot =
                transaction {
                    MonthlySnapshotEntity.all().toList().find {
                        it.assetId == "PETR4" && it.month == LocalDate.of(2024, 2, 1)
                    }
                }
            febSnapshot.shouldNotBeNull()
            febSnapshot.quantity shouldBe (5.0 plusOrMinus 0.001)
        }

        test("recalculate skips month when quantity is zero") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "SELL"
                    quantity = 10.0
                    price = 35.0
                    fees = 0.0
                    date = LocalDate.of(2024, 2, 10)
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 2, 28)
                    close = 36.0
                }
            }

            monthlyEvolutionService.recalculate()

            val febSnapshot =
                transaction {
                    MonthlySnapshotEntity.all().toList().find {
                        it.assetId == "PETR4" && it.month == LocalDate.of(2024, 2, 1)
                    }
                }
            febSnapshot.shouldBeNull()
        }

        test("recalculate skips month when no market price available") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                // No price history at all
            }

            monthlyEvolutionService.recalculate()

            val snapshots = transaction { MonthlySnapshotEntity.all().toList() }
            snapshots.shouldBeEmpty()
        }

        test("recalculate is idempotent") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
            }

            monthlyEvolutionService.recalculate()
            val countFirst = transaction { MonthlySnapshotEntity.all().count() }

            monthlyEvolutionService.recalculate()
            val countSecond = transaction { MonthlySnapshotEntity.all().count() }

            countFirst shouldBe countSecond
        }

        test("recalculate multiple assets") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                AssetEntity.new("VALE3") {
                    name = "Vale"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                TransactionEntity.new {
                    assetId = "VALE3"
                    type = "BUY"
                    quantity = 5.0
                    price = 60.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 20)
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
                PriceHistoryEntity.new {
                    assetId = "VALE3"
                    date = LocalDate.of(2024, 1, 30)
                    close = 65.0
                }
            }

            monthlyEvolutionService.recalculate()

            val snapshots = transaction { MonthlySnapshotEntity.all().toList() }
            val janPetr =
                snapshots.find {
                    it.assetId == "PETR4" && it.month == LocalDate.of(2024, 1, 1)
                }
            val janVale =
                snapshots.find {
                    it.assetId == "VALE3" && it.month == LocalDate.of(2024, 1, 1)
                }

            janPetr.shouldNotBeNull()
            janPetr.quantity shouldBe (10.0 plusOrMinus 0.001)
            janPetr.marketPrice shouldBe (32.0 plusOrMinus 0.001)

            janVale.shouldNotBeNull()
            janVale.quantity shouldBe (5.0 plusOrMinus 0.001)
            janVale.marketPrice shouldBe (65.0 plusOrMinus 0.001)
            janVale.marketValue shouldBe (325.0 plusOrMinus 0.001)
        }

        // --- getEvolution ---

        test("getEvolution returns empty when no snapshots") {
            val result = monthlyEvolutionService.getEvolution()
            result.months.shouldBeEmpty()
            result.tickers.shouldBeEmpty()
        }

        test("getEvolution returns data after recalculate") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 30.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 15)
                }
                PriceHistoryEntity.new {
                    assetId = "PETR4"
                    date = LocalDate.of(2024, 1, 30)
                    close = 32.0
                }
            }

            monthlyEvolutionService.recalculate()
            val result = monthlyEvolutionService.getEvolution()

            result.tickers shouldBe listOf("PETR4")
            val janRow = result.months.find { it.month == LocalDate.of(2024, 1, 1) }
            janRow.shouldNotBeNull()
            janRow.snapshots shouldHaveSize 1
            janRow.totalInvested shouldBe (300.0 plusOrMinus 0.001)
            janRow.totalMarketValue shouldBe (320.0 plusOrMinus 0.001)
        }
    })
