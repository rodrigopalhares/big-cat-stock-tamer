package com.stocks.service

import com.ninjasquad.springmockk.MockkBean
import com.stocks.clearAllData
import com.stocks.createAsset
import com.stocks.createDividend
import com.stocks.createMonthlySnapshot
import com.stocks.createPriceHistory
import com.stocks.createTransaction
import com.stocks.model.MonthlySnapshotEntity
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
            clearAllData()
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
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 10.0, date = LocalDate.of(2024, 3, 15))

            monthlyEvolutionService.findFirstTransactionMonth() shouldBe YearMonth.of(2024, 3)
        }

        test("findFirstTransactionMonth returns earliest across assets") {
            createAsset("PETR4", name = "Petrobras")
            createAsset("VALE3", name = "Vale")
            createTransaction("PETR4", price = 10.0, date = LocalDate.of(2024, 5, 1))
            createTransaction("VALE3", price = 50.0, date = LocalDate.of(2024, 2, 10))

            monthlyEvolutionService.findFirstTransactionMonth() shouldBe YearMonth.of(2024, 2)
        }

        // --- getMonthEndPrice ---

        test("getMonthEndPrice returns null when no prices") {
            createAsset("PETR4", name = "Petrobras")

            monthlyEvolutionService.getMonthEndPrice("PETR4", LocalDate.of(2024, 1, 31)).shouldBeNull()
        }

        test("getMonthEndPrice returns latest price on or before date") {
            createAsset("PETR4", name = "Petrobras")
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 15), 30.0)
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createPriceHistory("PETR4", LocalDate.of(2024, 2, 5), 35.0)

            monthlyEvolutionService.getMonthEndPrice("PETR4", LocalDate.of(2024, 1, 31)) shouldBe (32.0 plusOrMinus 0.001)
        }

        test("getMonthEndPrice ignores prices after date") {
            createAsset("PETR4", name = "Petrobras")
            createPriceHistory("PETR4", LocalDate.of(2024, 2, 5), 35.0)

            monthlyEvolutionService.getMonthEndPrice("PETR4", LocalDate.of(2024, 1, 31)).shouldBeNull()
        }

        // --- recalculate ---

        test("recalculate single asset single month") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)

            monthlyEvolutionService.recalculate()

            val snapshots = transaction { MonthlySnapshotEntity.all().toList() }
            snapshots.shouldNotBeNull()
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
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createPriceHistory("PETR4", LocalDate.of(2024, 2, 28), 35.0)

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
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createTransaction("PETR4", type = "SELL", quantity = -5.0, price = 35.0, date = LocalDate.of(2024, 2, 10))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createPriceHistory("PETR4", LocalDate.of(2024, 2, 28), 36.0)

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
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createTransaction("PETR4", type = "SELL", quantity = -10.0, price = 35.0, date = LocalDate.of(2024, 2, 10))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createPriceHistory("PETR4", LocalDate.of(2024, 2, 28), 36.0)

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
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))

            monthlyEvolutionService.recalculate()

            val snapshots = transaction { MonthlySnapshotEntity.all().toList() }
            snapshots.shouldBeEmpty()
        }

        test("recalculate is idempotent") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)

            monthlyEvolutionService.recalculate()
            val countFirst = transaction { MonthlySnapshotEntity.all().count() }

            monthlyEvolutionService.recalculate()
            val countSecond = transaction { MonthlySnapshotEntity.all().count() }

            countFirst shouldBe countSecond
        }

        test("recalculate multiple assets") {
            createAsset("PETR4", name = "Petrobras")
            createAsset("VALE3", name = "Vale")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createTransaction("VALE3", quantity = 5.0, price = 60.0, date = LocalDate.of(2024, 1, 20))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createPriceHistory("VALE3", LocalDate.of(2024, 1, 30), 65.0)

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

        test("getEvolution fills month gaps with zero values") {
            createAsset("PETR4", name = "Petrobras")
            createMonthlySnapshot("PETR4", LocalDate.of(2024, 1, 1), 10.0, 30.0, 32.0, 300.0, 320.0)
            createMonthlySnapshot("PETR4", LocalDate.of(2024, 3, 1), 10.0, 30.0, 35.0, 300.0, 350.0)

            val result = monthlyEvolutionService.getEvolution()

            result.months shouldHaveSize 3
            result.months[0].month shouldBe LocalDate.of(2024, 1, 1)
            result.months[1].month shouldBe LocalDate.of(2024, 2, 1)
            result.months[2].month shouldBe LocalDate.of(2024, 3, 1)

            result.months[1].snapshots.shouldBeEmpty()
            result.months[1].totalInvested shouldBe (0.0 plusOrMinus 0.001)
            result.months[1].totalMarketValue shouldBe (0.0 plusOrMinus 0.001)
        }

        // --- recalculate with dividends ---

        test("recalculate stores accumulated net dividends") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createDividend("PETR4", date = LocalDate.of(2024, 1, 20), totalAmount = 50.0, taxWithheld = 10.0)

            monthlyEvolutionService.recalculate()

            val snapshot =
                transaction {
                    MonthlySnapshotEntity.all().toList().find {
                        it.assetId == "PETR4" && it.month == LocalDate.of(2024, 1, 1)
                    }
                }
            snapshot.shouldNotBeNull()
            snapshot.accumulatedNetDividends shouldBe (40.0 plusOrMinus 0.001)
        }

        test("recalculate accumulates dividends across months") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createPriceHistory("PETR4", LocalDate.of(2024, 2, 28), 35.0)
            createDividend("PETR4", date = LocalDate.of(2024, 1, 20), totalAmount = 50.0, taxWithheld = 10.0)
            createDividend("PETR4", date = LocalDate.of(2024, 2, 15), totalAmount = 30.0, taxWithheld = 0.0)

            monthlyEvolutionService.recalculate()

            val snapshots = transaction { MonthlySnapshotEntity.all().toList() }
            val jan = snapshots.find { it.month == LocalDate.of(2024, 1, 1) }
            val feb = snapshots.find { it.month == LocalDate.of(2024, 2, 1) }

            jan.shouldNotBeNull()
            jan.accumulatedNetDividends shouldBe (40.0 plusOrMinus 0.001)

            feb.shouldNotBeNull()
            feb.accumulatedNetDividends shouldBe (70.0 plusOrMinus 0.001)
        }

        // --- getEvolution with dividends ---

        test("getEvolution includes totalAccumulatedNetDividends summing all assets") {
            createAsset("PETR4", name = "Petrobras")
            createAsset("VALE3", name = "Vale")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createTransaction("VALE3", quantity = 5.0, price = 60.0, date = LocalDate.of(2024, 1, 20))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)
            createPriceHistory("VALE3", LocalDate.of(2024, 1, 30), 65.0)
            createDividend("PETR4", date = LocalDate.of(2024, 1, 20), totalAmount = 50.0, taxWithheld = 10.0)
            createDividend("VALE3", date = LocalDate.of(2024, 1, 25), totalAmount = 100.0, taxWithheld = 15.0)

            monthlyEvolutionService.recalculate()
            val result = monthlyEvolutionService.getEvolution()

            val janRow = result.months.find { it.month == LocalDate.of(2024, 1, 1) }
            janRow.shouldNotBeNull()
            janRow.totalAccumulatedNetDividends shouldBe (125.0 plusOrMinus 0.001)
        }

        test("getEvolution returns zero totalAccumulatedNetDividends when no dividends") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)

            monthlyEvolutionService.recalculate()
            val result = monthlyEvolutionService.getEvolution()

            val janRow = result.months.find { it.month == LocalDate.of(2024, 1, 1) }
            janRow.shouldNotBeNull()
            janRow.totalAccumulatedNetDividends shouldBe (0.0 plusOrMinus 0.001)
        }

        test("getEvolution returns data after recalculate") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", price = 30.0, date = LocalDate.of(2024, 1, 15))
            createPriceHistory("PETR4", LocalDate.of(2024, 1, 30), 32.0)

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
