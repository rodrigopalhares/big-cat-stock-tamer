package com.stocks.service

import com.ninjasquad.springmockk.MockkBean
import com.stocks.clearAllData
import com.stocks.createAsset
import com.stocks.createTransaction
import com.stocks.model.PriceHistories
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.mockk.every
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
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

        test("categorizeAssets skips delisted asset") {
            val assets =
                listOf(
                    AssetTickerInfo("PETR4", null, "STOCK", delisted = true),
                    AssetTickerInfo("VALE3", null, "STOCK"),
                )
            val result = categorizeAssets(assets)
            result.yfTickerMap shouldBe mapOf("VALE3.SA" to "VALE3")
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

@ApplyExtension(SpringExtension::class)
@SpringBootTest
@ActiveProfiles("test")
class PriceHistoryServiceIntegrationTest(
    private val priceHistoryService: PriceHistoryService,
    @MockkBean private val quoteService: QuoteService,
) : FunSpec({

        beforeEach {
            clearAllData()
        }

        // --- getLatestPrice ---

        test("getLatestPrice returns price") {
            createAsset("PETR4", name = "Petrobras")
            priceHistoryService.upsertPrices(
                listOf(
                    PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0),
                    PriceRecord("PETR4", LocalDate.of(2024, 1, 2), 31.0),
                ),
            )
            priceHistoryService.getLatestPrice("PETR4") shouldBe (31.0 plusOrMinus 0.001)
        }

        test("getLatestPrice returns null when empty") {
            createAsset("PETR4", name = "Petrobras")
            priceHistoryService.getLatestPrice("PETR4").shouldBeNull()
        }

        // --- getLastStoredDate ---

        test("getLastStoredDate returns date") {
            createAsset("PETR4", name = "Petrobras")
            priceHistoryService.upsertPrices(
                listOf(
                    PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0),
                    PriceRecord("PETR4", LocalDate.of(2024, 3, 1), 32.0),
                ),
            )
            priceHistoryService.getLastStoredDate("PETR4") shouldBe LocalDate.of(2024, 3, 1)
        }

        test("getLastStoredDate returns null when empty") {
            createAsset("PETR4", name = "Petrobras")
            priceHistoryService.getLastStoredDate("PETR4").shouldBeNull()
        }

        // --- upsertPrices ---

        test("upsertPrices inserts new records") {
            createAsset("PETR4", name = "Petrobras")
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
            createAsset("PETR4", name = "Petrobras")
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

        // --- generateDelistedPrices ---

        test("generateDelistedPrices with no transactions does nothing") {
            createAsset("DELIST1", name = "Delisted Corp", delisted = true)

            priceHistoryService.generateDelistedPrices("DELIST1")

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 0
        }

        test("generateDelistedPrices with one transaction repeats price") {
            val txDate = LocalDate.now().minusDays(3)
            createAsset("DELIST1", name = "Delisted Corp", delisted = true)
            createTransaction("DELIST1", price = 25.0, date = txDate)

            priceHistoryService.generateDelistedPrices("DELIST1")

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 4
            priceHistoryService.getLatestPrice("DELIST1") shouldBe (25.0 plusOrMinus 0.001)
        }

        test("generateDelistedPrices with two transactions interpolates") {
            val dateA = LocalDate.of(2024, 1, 1)
            val dateB = LocalDate.of(2024, 1, 5)
            createAsset("DELIST2", name = "Delisted Corp 2", delisted = true)
            createTransaction("DELIST2", price = 10.0, date = dateA)
            createTransaction("DELIST2", type = "SELL", quantity = 10.0, price = 20.0, date = dateB)

            priceHistoryService.generateDelistedPrices("DELIST2")

            val jan3Price =
                priceHistoryService.getPricesForDate(listOf("DELIST2"), LocalDate.of(2024, 1, 3))
            jan3Price["DELIST2"] shouldBe (15.0 plusOrMinus 0.001)

            val latestPrice = priceHistoryService.getLatestPrice("DELIST2")
            latestPrice shouldBe (20.0 plusOrMinus 0.001)
        }

        test("runBackfill processes delisted assets without calling Yahoo API") {
            createAsset("DELIST1", name = "Delisted Corp", delisted = true)
            createTransaction("DELIST1", price = 25.0, date = LocalDate.now().minusDays(2))

            priceHistoryService.runBackfill()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 3
        }

        test("runBackfill stock asset fetches and stores prices") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", date = LocalDate.of(2024, 1, 1))

            every {
                quoteService.fetchHistoricalQuotesBatch(any(), any())
            } returns
                mapOf(
                    "PETR4" to
                        listOf(
                            LocalDate.of(2024, 1, 1) to 30.0,
                            LocalDate.of(2024, 1, 2) to 31.0,
                        ),
                )

            priceHistoryService.runBackfill()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 2
        }

        test("runBackfill td asset fetches and stores prices") {
            createAsset("TD1", name = "Tesouro Selic 2029", type = "TESOURO_DIRETO", yfTicker = "Tesouro Selic;01/03/2029")
            createTransaction("TD1", quantity = 1.0, price = 14000.0, date = LocalDate.of(2024, 1, 1))

            every {
                quoteService.fetchTdHistoricalQuotesBatch(any())
            } returns
                mapOf(
                    "Tesouro Selic;01/03/2029" to
                        listOf(
                            LocalDate.of(2024, 1, 1) to 14000.0,
                            LocalDate.of(2024, 1, 2) to 14010.0,
                        ),
                )

            priceHistoryService.runBackfill()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 2
        }

        test("runBackfill skips asset without transactions") {
            createAsset("PETR4", name = "Petrobras")

            priceHistoryService.runBackfill()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 0
        }

        test("runBackfill handles api error gracefully") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", date = LocalDate.of(2024, 1, 1))

            every {
                quoteService.fetchHistoricalQuotesBatch(any(), any())
            } throws RuntimeException("API error")

            priceHistoryService.runBackfill()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 0
        }

        test("runBackfill uses lastStoredDate as start") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", date = LocalDate.of(2024, 1, 1))

            priceHistoryService.upsertPrices(
                listOf(PriceRecord("PETR4", LocalDate.of(2024, 1, 1), 30.0)),
            )

            every {
                quoteService.fetchHistoricalQuotesBatch(any(), any())
            } returns
                mapOf(
                    "PETR4" to
                        listOf(
                            LocalDate.of(2024, 1, 1) to 30.0,
                            LocalDate.of(2024, 1, 2) to 31.0,
                            LocalDate.of(2024, 1, 3) to 32.0,
                        ),
                )

            priceHistoryService.runBackfill()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 3
        }

        // --- runDailyUpdate ---

        test("runDailyUpdate stock asset") {
            val today = LocalDate.now()
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", date = LocalDate.of(2024, 1, 1))

            every {
                quoteService.fetchHistoricalQuotesBatch(any(), any())
            } returns
                mapOf(
                    "PETR4" to listOf(today to 35.0),
                )

            priceHistoryService.runDailyUpdate()

            priceHistoryService.getLatestPrice("PETR4") shouldBe (35.0 plusOrMinus 0.001)
        }

        test("runDailyUpdate skips asset without transactions") {
            createAsset("PETR4", name = "Petrobras")

            priceHistoryService.runDailyUpdate()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 0
        }

        test("runDailyUpdate handles api error gracefully") {
            createAsset("PETR4", name = "Petrobras")
            createTransaction("PETR4", date = LocalDate.of(2024, 1, 1))

            every {
                quoteService.fetchHistoricalQuotesBatch(any(), any())
            } throws RuntimeException("API error")

            priceHistoryService.runDailyUpdate()

            val count = transaction { PriceHistories.selectAll().count() }
            count shouldBe 0
        }
    })
