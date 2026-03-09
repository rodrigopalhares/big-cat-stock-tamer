package com.stocks.service

import com.stocks.clearAllData
import com.stocks.createAsset
import com.stocks.createDividend
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.maps.shouldContainKey
import io.kotest.matchers.shouldBe
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.ActiveProfiles
import org.springframework.web.server.ResponseStatusException
import java.time.LocalDate

@ApplyExtension(SpringExtension::class)
@SpringBootTest
@ActiveProfiles("test")
class DividendServiceTest(
    private val dividendService: DividendService,
) : FunSpec({

        beforeEach {
            clearAllData()
        }

        test("create dividend for existing asset") {
            createAsset("PETR4", name = "Petrobras")

            val dividend =
                dividendService.createDividend(
                    ticker = "PETR4",
                    type = "DIVIDENDO",
                    date = LocalDate.of(2024, 6, 15),
                    totalAmount = 100.0,
                    taxWithheld = 0.0,
                    notes = "Dividendo trimestral",
                    broker = "XP",
                    currency = "BRL",
                )

            transaction {
                dividend.assetId shouldBe "PETR4"
                dividend.type shouldBe "DIVIDENDO"
                dividend.totalAmount shouldBe (100.0 plusOrMinus 0.001)
                dividend.taxWithheld shouldBe (0.0 plusOrMinus 0.001)
                dividend.broker shouldBe "XP"
                dividend.currency shouldBe "BRL"
            }
        }

        test("create dividend normalizes ticker to uppercase") {
            createAsset("MXRF11", name = "Maxi Renda", type = "REIT")

            val dividend =
                dividendService.createDividend(
                    ticker = "mxrf11",
                    type = "RENDIMENTO",
                    date = LocalDate.of(2024, 6, 15),
                    totalAmount = 50.0,
                    taxWithheld = 0.0,
                    notes = null,
                )

            transaction {
                dividend.assetId shouldBe "MXRF11"
                dividend.type shouldBe "RENDIMENTO"
            }
        }

        test("create dividend with JCP and tax withheld") {
            createAsset("BBAS3", name = "Banco do Brasil")

            val dividend =
                dividendService.createDividend(
                    ticker = "BBAS3",
                    type = "JCP",
                    date = LocalDate.of(2024, 3, 20),
                    totalAmount = 200.0,
                    taxWithheld = 30.0,
                    notes = null,
                )

            transaction {
                dividend.type shouldBe "JCP"
                dividend.totalAmount shouldBe (200.0 plusOrMinus 0.001)
                dividend.taxWithheld shouldBe (30.0 plusOrMinus 0.001)
            }
        }

        test("create dividend with blank notes stores null") {
            createAsset("PETR4", name = "Petrobras")

            val dividend =
                dividendService.createDividend(
                    ticker = "PETR4",
                    type = "DIVIDENDO",
                    date = LocalDate.of(2024, 6, 15),
                    totalAmount = 100.0,
                    taxWithheld = 0.0,
                    notes = "   ",
                )

            transaction {
                dividend.notes shouldBe null
            }
        }

        test("list dividends returns all sorted by date desc") {
            createAsset("PETR4", name = "Petrobras")
            createDividend("PETR4", date = LocalDate.of(2024, 3, 15), totalAmount = 50.0)
            createDividend("PETR4", type = "JCP", date = LocalDate.of(2024, 6, 15), totalAmount = 100.0, taxWithheld = 15.0)

            val dividends = dividendService.listDividends()
            dividends shouldHaveSize 2
            transaction {
                dividends[0].date shouldBe LocalDate.of(2024, 6, 15)
                dividends[1].date shouldBe LocalDate.of(2024, 3, 15)
            }
        }

        test("list dividends filtered by ticker") {
            createAsset("PETR4", name = "Petrobras")
            createAsset("VALE3", name = "Vale")
            createDividend("PETR4", date = LocalDate.of(2024, 3, 15), totalAmount = 50.0)
            createDividend("VALE3", date = LocalDate.of(2024, 6, 15), totalAmount = 80.0)

            val dividends = dividendService.listDividends(ticker = "PETR4")
            dividends shouldHaveSize 1
            transaction { dividends[0].assetId shouldBe "PETR4" }
        }

        test("list dividends filtered by type") {
            createAsset("PETR4", name = "Petrobras")
            createDividend("PETR4", date = LocalDate.of(2024, 3, 15), totalAmount = 50.0)
            createDividend("PETR4", type = "JCP", date = LocalDate.of(2024, 6, 15), totalAmount = 100.0, taxWithheld = 15.0)

            val dividends = dividendService.listDividends(type = "JCP")
            dividends shouldHaveSize 1
            transaction { dividends[0].type shouldBe "JCP" }
        }

        test("delete dividend success") {
            createAsset("PETR4", name = "Petrobras")
            val dividend = createDividend("PETR4", date = LocalDate.of(2024, 3, 15), totalAmount = 50.0)
            val dividendId = transaction { dividend.id.value }

            dividendService.deleteDividend(dividendId)

            val remaining = dividendService.listDividends()
            remaining shouldHaveSize 0
        }

        test("delete dividend not found throws 404") {
            try {
                dividendService.deleteDividend(9999)
                throw AssertionError("Should have thrown ResponseStatusException")
            } catch (e: ResponseStatusException) {
                e.statusCode.value() shouldBe 404
            }
        }

        test("getDividendPnlByAsset returns net amounts grouped by ticker") {
            createAsset("PETR4", name = "Petrobras")
            createAsset("VALE3", name = "Vale")
            createDividend("PETR4", date = LocalDate.of(2024, 3, 15), totalAmount = 100.0)
            createDividend("PETR4", type = "JCP", date = LocalDate.of(2024, 6, 15), totalAmount = 200.0, taxWithheld = 30.0)
            createDividend("VALE3", date = LocalDate.of(2024, 6, 15), totalAmount = 50.0)

            val pnl = dividendService.getDividendPnlByAsset()
            pnl shouldContainKey "PETR4"
            pnl shouldContainKey "VALE3"
            pnl["PETR4"]!! shouldBe (270.0 plusOrMinus 0.001) // 100 + (200 - 30)
            pnl["VALE3"]!! shouldBe (50.0 plusOrMinus 0.001)
        }

        test("getDividendPnlByAsset returns empty map when no dividends") {
            val pnl = dividendService.getDividendPnlByAsset()
            pnl.size shouldBe 0
        }

        test("getDividendCashFlowsByAsset returns date-amount pairs grouped by ticker") {
            createAsset("PETR4", name = "Petrobras")
            createDividend("PETR4", date = LocalDate.of(2024, 3, 15), totalAmount = 100.0, taxWithheld = 10.0)
            createDividend("PETR4", type = "JCP", date = LocalDate.of(2024, 6, 15), totalAmount = 200.0, taxWithheld = 30.0)

            val cashFlows = dividendService.getDividendCashFlowsByAsset()
            cashFlows shouldContainKey "PETR4"
            cashFlows["PETR4"]!! shouldHaveSize 2
            val flows = cashFlows["PETR4"]!!.sortedBy { it.first }
            flows[0].first shouldBe LocalDate.of(2024, 3, 15)
            flows[0].second shouldBe (90.0 plusOrMinus 0.001) // 100 - 10
            flows[1].first shouldBe LocalDate.of(2024, 6, 15)
            flows[1].second shouldBe (170.0 plusOrMinus 0.001) // 200 - 30
        }
    })
