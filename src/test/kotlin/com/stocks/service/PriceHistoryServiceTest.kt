package com.stocks.service

import com.ninjasquad.springmockk.MockkBean
import com.stocks.model.AssetEntity
import com.stocks.model.PriceHistories
import com.stocks.model.TransactionEntity
import org.jetbrains.exposed.sql.deleteAll
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.extensions.spring.SpringExtension
import io.mockk.every
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.ActiveProfiles
import java.time.LocalDate

// ==================== Unit Tests (pure functions, no Spring) ====================

class ResolveYfTickerTest :
    FunSpec({
        test("resolveYfTicker with explicit yfTicker") {
            resolveYfTicker("PETR4", "PETR4.SA") shouldBe "PETR4.SA"
        }

        test("resolveYfTicker without yfTicker appends .SA") {
            resolveYfTicker("PETR4", null) shouldBe "PETR4.SA"
        }

        test("resolveYfTicker ticker with dot keeps as is") {
            resolveYfTicker("SAP.DE", null) shouldBe "SAP.DE"
        }
    })

class CategorizeAssetsTest :
    FunSpec({
        test("categorizeAssets stock goes to yfMap") {
            val assets = listOf(AssetTickerInfo("PETR4", null, "STOCK"))
            val result = categorizeAssets(assets)
            result.yfTickerMap shouldBe mapOf("PETR4.SA" to "PETR4")
            result.tdTickerMap shouldBe emptyMap()
        }

        test("categorizeAssets td goes to tdMap") {
            val assets = listOf(AssetTickerInfo("TD1", "Tesouro Selic;01/03/2029", "TESOURO_DIRETO"))
            val result = categorizeAssets(assets)
            result.yfTickerMap shouldBe emptyMap()
            result.tdTickerMap shouldBe mapOf("Tesouro Selic;01/03/2029" to "TD1")
        }

        test("categorizeAssets td without yfTicker excluded") {
            val assets = listOf(AssetTickerInfo("TD1", null, "TESOURO_DIRETO"))
            val result = categorizeAssets(assets)
            result.yfTickerMap shouldBe emptyMap()
            result.tdTickerMap shouldBe emptyMap()
        }

        test("categorizeAssets mixed assets") {
            val assets =
                listOf(
                    AssetTickerInfo("PETR4", null, "STOCK"),
                    AssetTickerInfo("TD1", "Tesouro Selic;01/03/2029", "TESOURO_DIRETO"),
                    AssetTickerInfo("BOVA11", "BOVA11.SA", "ETF"),
                )
            val result = categorizeAssets(assets)
            result.yfTickerMap shouldBe mapOf("PETR4.SA" to "PETR4", "BOVA11.SA" to "BOVA11")
            result.tdTickerMap shouldBe mapOf("Tesouro Selic;01/03/2029" to "TD1")
        }
    })

class FilterBatchToRecordsTest :
    FunSpec({
        test("filterBatchToRecords empty batch") {
            val result = filterBatchToRecords(emptyMap()) { _, _ -> true }
            result.shouldBeEmpty()
        }

        test("filterBatchToRecords filters by date") {
            val cutoff = LocalDate.of(2024, 6, 1)
            val batch =
                mapOf(
                    "PETR4" to
                        listOf(
                            LocalDate.of(2024, 5, 1) to 30.0,
                            LocalDate.of(2024, 6, 1) to 31.0,
                            LocalDate.of(2024, 7, 1) to 32.0,
                        ),
                )
            val result = filterBatchToRecords(batch) { _, date -> date >= cutoff }
            result shouldHaveSize 2
            result[0] shouldBe PriceRecord("PETR4", LocalDate.of(2024, 6, 1), 31.0)
            result[1] shouldBe PriceRecord("PETR4", LocalDate.of(2024, 7, 1), 32.0)
        }

        test("filterBatchToRecords with ticker resolver") {
            val resolverMap = mapOf("Tesouro Selic;01/03/2029" to "TD1")
            val batch =
                mapOf(
                    "Tesouro Selic;01/03/2029" to
                        listOf(
                            LocalDate.of(2024, 1, 1) to 14000.0,
                        ),
                )
            val result = filterBatchToRecords(batch, { resolverMap[it] }) { _, _ -> true }
            result shouldHaveSize 1
            result[0].assetId shouldBe "TD1"
        }

        test("filterBatchToRecords resolver returns null skips") {
            val batch =
                mapOf(
                    "UNKNOWN" to
                        listOf(
                            LocalDate.of(2024, 1, 1) to 100.0,
                        ),
                )
            val result = filterBatchToRecords(batch, { null }) { _, _ -> true }
            result.shouldBeEmpty()
        }
    })

// ==================== Integration Tests (SpringBootTest + MockkBean) ====================

@SpringBootTest
@ActiveProfiles("test")
class PriceHistoryServiceIntegrationTest(
    private val priceHistoryService: PriceHistoryService,
    @MockkBean private val quoteService: QuoteService,
) : FunSpec({

    extensions(SpringExtension)

    beforeEach {
        transaction {
            // Clean up in correct order: prices -> transactions -> assets
            PriceHistories.deleteAll()
            TransactionEntity.all().forEach { it.delete() }
            AssetEntity.all().forEach { it.delete() }
        }
    }

    // --- getLatestPrice ---

    test("getLatestPrice returns price") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }
        priceHistoryService.upsertPrices(
            listOf(
                PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0),
                PriceRecord("PETR4", LocalDate.of(2024, 1, 2), 31.0),
            ),
        )
        priceHistoryService.getLatestPrice("PETR4") shouldBe (31.0 plusOrMinus 0.001)
    }

    test("getLatestPrice returns null when empty") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }
        priceHistoryService.getLatestPrice("PETR4").shouldBeNull()
    }

    // --- getLastStoredDate ---

    test("getLastStoredDate returns date") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }
        priceHistoryService.upsertPrices(
            listOf(
                PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0),
                PriceRecord("PETR4", LocalDate.of(2024, 3, 1), 32.0),
            ),
        )
        priceHistoryService.getLastStoredDate("PETR4") shouldBe LocalDate.of(2024, 3, 1)
    }

    test("getLastStoredDate returns null when empty") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }
        priceHistoryService.getLastStoredDate("PETR4").shouldBeNull()
    }

    // --- upsertPrices ---

    test("upsertPrices inserts new records") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }
        priceHistoryService.upsertPrices(
            listOf(
                PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0),
                PriceRecord("PETR4", LocalDate.of(2024, 1, 2), 31.0),
            ),
        )
        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 2
    }

    test("upsertPrices updates existing records") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }
        priceHistoryService.upsertPrices(
            listOf(PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0)),
        )
        priceHistoryService.upsertPrices(
            listOf(PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 35.0)),
        )
        priceHistoryService.getLatestPrice("PETR4") shouldBe (35.0 plusOrMinus 0.001)
        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 1
    }

    test("upsertPrices empty list does nothing") {
        priceHistoryService.upsertPrices(emptyList())
        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 0
    }

    // --- runBackfill ---

    test("runBackfill stock asset fetches and stores prices") {
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
                date = LocalDate.of(2024, 1, 1)
            }
        }

        every {
            quoteService.fetchHistoricalQuotesBatch(any(), any())
        } returns mapOf(
            "PETR4" to listOf(
                LocalDate.of(2024, 1, 1) to 30.0,
                LocalDate.of(2024, 1, 2) to 31.0,
            ),
        )

        priceHistoryService.runBackfill()

        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 2
    }

    test("runBackfill td asset fetches and stores prices") {
        transaction {
            AssetEntity.new("TD1") {
                name = "Tesouro Selic 2029"
                type = "TESOURO_DIRETO"
                yfTicker = "Tesouro Selic;01/03/2029"
                currency = "BRL"
            }
            TransactionEntity.new {
                assetId = "TD1"
                type = "BUY"
                quantity = 1.0
                price = 14000.0
                fees = 0.0
                date = LocalDate.of(2024, 1, 1)
            }
        }

        every {
            quoteService.fetchTdHistoricalQuotesBatch(any())
        } returns mapOf(
            "Tesouro Selic;01/03/2029" to listOf(
                LocalDate.of(2024, 1, 1) to 14000.0,
                LocalDate.of(2024, 1, 2) to 14010.0,
            ),
        )

        priceHistoryService.runBackfill()

        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 2
    }

    test("runBackfill skips asset without transactions") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }

        priceHistoryService.runBackfill()

        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 0
    }

    test("runBackfill handles api error gracefully") {
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
                date = LocalDate.of(2024, 1, 1)
            }
        }

        every {
            quoteService.fetchHistoricalQuotesBatch(any(), any())
        } throws RuntimeException("API error")

        priceHistoryService.runBackfill()

        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 0
    }

    test("runBackfill uses lastStoredDate as start") {
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
                date = LocalDate.of(2024, 1, 1)
            }
        }

        // Insert an existing price record
        priceHistoryService.upsertPrices(
            listOf(PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0)),
        )

        every {
            quoteService.fetchHistoricalQuotesBatch(any(), any())
        } returns mapOf(
            "PETR4" to listOf(
                LocalDate.of(2024, 1, 1) to 30.0,
                LocalDate.of(2024, 1, 2) to 31.0,
                LocalDate.of(2024, 1, 3) to 32.0,
            ),
        )

        priceHistoryService.runBackfill()

        // Should have the original + 2 new records (date >= Jan 2 because lastStored=Jan 1, start=Jan 2)
        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 3
    }

    // --- runDailyUpdate ---

    test("runDailyUpdate stock asset") {
        val today = LocalDate.now()
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
                date = LocalDate.of(2024, 1, 1)
            }
        }

        every {
            quoteService.fetchHistoricalQuotesBatch(any(), any())
        } returns mapOf(
            "PETR4" to listOf(today to 35.0),
        )

        priceHistoryService.runDailyUpdate()

        priceHistoryService.getLatestPrice("PETR4") shouldBe (35.0 plusOrMinus 0.001)
    }

    test("runDailyUpdate skips asset without transactions") {
        transaction {
            AssetEntity.new("PETR4") {
                name = "Petrobras"
                type = "STOCK"
                currency = "BRL"
            }
        }

        priceHistoryService.runDailyUpdate()

        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 0
    }

    test("runDailyUpdate handles api error gracefully") {
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
                date = LocalDate.of(2024, 1, 1)
            }
        }

        every {
            quoteService.fetchHistoricalQuotesBatch(any(), any())
        } throws RuntimeException("API error")

        priceHistoryService.runDailyUpdate()

        val count = transaction { PriceHistories.selectAll().count() }
        count shouldBe 0
    }
})
