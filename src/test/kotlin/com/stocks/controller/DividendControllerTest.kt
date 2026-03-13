package com.stocks.controller

import com.stocks.model.AssetEntity
import com.stocks.model.DividendEntity
import com.stocks.model.TransactionEntity
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import java.time.LocalDate

@ApplyExtension(SpringExtension::class)
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DividendControllerTest(
    private val mockMvc: MockMvc,
) : FunSpec({

        beforeEach {
            transaction {
                DividendEntity.all().forEach { it.delete() }
                TransactionEntity.all().forEach { it.delete() }
                AssetEntity.all().forEach { it.delete() }
            }
        }

        // --- HTML Routes ---

        test("list dividends page renders empty state") {
            val result =
                mockMvc
                    .perform(get("/dividends/"))
                    .andExpect(status().isOk)
                    .andReturn()

            result.response.contentAsString shouldContain "Nenhum provento registrado"
        }

        test("list dividends page shows existing dividends") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 6, 15)
                    totalAmount = 100.0
                    taxWithheld = 0.0
                }
            }

            val result =
                mockMvc
                    .perform(get("/dividends/"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "PETR4"
            body shouldContain "DIVIDENDO"
        }

        test("create dividend via form redirects") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/dividends/new")
                        .param("ticker", "PETR4")
                        .param("type", "DIVIDENDO")
                        .param("total_amount", "100.0")
                        .param("tax_withheld", "0.0")
                        .param("date", "2024-06-15")
                        .param("notes", "")
                ).andExpect(status().is3xxRedirection)
                .andExpect(redirectedUrl("/dividends/"))

            val count = transaction { DividendEntity.all().count() }
            assert(count == 1L) { "Expected 1 dividend, got $count" }
        }

        test("delete dividend via form redirects") {
            val dividendId =
                transaction {
                    AssetEntity.new("PETR4") {
                        name = "Petrobras"
                        type = "STOCK"
                        currency = "BRL"
                    }
                    val d =
                        DividendEntity.new {
                            assetId = "PETR4"
                            type = "DIVIDENDO"
                            date = LocalDate.of(2024, 6, 15)
                            totalAmount = 100.0
                            taxWithheld = 0.0
                        }
                    d.id.value
                }

            mockMvc
                .perform(post("/dividends/$dividendId/delete"))
                .andExpect(status().is3xxRedirection)
                .andExpect(redirectedUrl("/dividends/"))

            val count = transaction { DividendEntity.all().count() }
            assert(count == 0L) { "Expected 0 dividends, got $count" }
        }

        test("filter dividends by ticker") {
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
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 6, 15)
                    totalAmount = 100.0
                    taxWithheld = 0.0
                }
                DividendEntity.new {
                    assetId = "VALE3"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 6, 15)
                    totalAmount = 50.0
                    taxWithheld = 0.0
                }
            }

            val result =
                mockMvc
                    .perform(get("/dividends/").param("ticker", "PETR4"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "PETR4</a>"
            body shouldNotContain "VALE3</a>"
        }

        test("filter dividends by type via api") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 3, 15)
                    totalAmount = 50.0
                    taxWithheld = 0.0
                }
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "JCP"
                    date = LocalDate.of(2024, 6, 15)
                    totalAmount = 100.0
                    taxWithheld = 15.0
                }
            }

            mockMvc
                .perform(get("/dividends/api?type=JCP"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].type").value("JCP"))
        }

        // --- JSON API Routes ---

        test("create dividend api success") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/dividends/api")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                            """
                            {
                                "assetId": "PETR4",
                                "type": "DIVIDENDO",
                                "date": "2024-06-15",
                                "totalAmount": 100.0,
                                "taxWithheld": 0.0
                            }
                            """.trimIndent()
                        )
                ).andExpect(status().isCreated)
                .andExpect(jsonPath("$.assetId").value("PETR4"))
                .andExpect(jsonPath("$.type").value("DIVIDENDO"))
                .andExpect(jsonPath("$.totalAmount").value(100.0))
                .andExpect(jsonPath("$.netAmount").value(100.0))
        }

        test("create dividend api with JCP and tax") {
            transaction {
                AssetEntity.new("BBAS3") {
                    name = "Banco do Brasil"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/dividends/api")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                            """
                            {
                                "assetId": "BBAS3",
                                "type": "JCP",
                                "date": "2024-06-15",
                                "totalAmount": 200.0,
                                "taxWithheld": 30.0
                            }
                            """.trimIndent()
                        )
                ).andExpect(status().isCreated)
                .andExpect(jsonPath("$.type").value("JCP"))
                .andExpect(jsonPath("$.totalAmount").value(200.0))
                .andExpect(jsonPath("$.taxWithheld").value(30.0))
                .andExpect(jsonPath("$.netAmount").value(170.0))
        }

        test("list dividends api returns all") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 3, 15)
                    totalAmount = 50.0
                    taxWithheld = 0.0
                }
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "JCP"
                    date = LocalDate.of(2024, 6, 15)
                    totalAmount = 100.0
                    taxWithheld = 15.0
                }
            }

            mockMvc
                .perform(get("/dividends/api"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.length()").value(2))
        }

        test("list dividends api filtered by ticker") {
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
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 3, 15)
                    totalAmount = 50.0
                    taxWithheld = 0.0
                }
                DividendEntity.new {
                    assetId = "VALE3"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 6, 15)
                    totalAmount = 80.0
                    taxWithheld = 0.0
                }
            }

            mockMvc
                .perform(get("/dividends/api?ticker=PETR4"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].assetId").value("PETR4"))
        }

        test("delete dividend api success") {
            val dividendId =
                transaction {
                    AssetEntity.new("PETR4") {
                        name = "Petrobras"
                        type = "STOCK"
                        currency = "BRL"
                    }
                    val d =
                        DividendEntity.new {
                            assetId = "PETR4"
                            type = "DIVIDENDO"
                            date = LocalDate.of(2024, 6, 15)
                            totalAmount = 100.0
                            taxWithheld = 0.0
                        }
                    d.id.value
                }

            mockMvc
                .perform(delete("/dividends/api/$dividendId"))
                .andExpect(status().isNoContent)
        }

        test("delete dividend api not found") {
            mockMvc
                .perform(delete("/dividends/api/9999"))
                .andExpect(status().isNotFound)
        }

        // --- Portfolio Integration ---

        test("portfolio api includes dividend pnl") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                    hasPosition = true
                    quantity = 10.0
                    avgPrice = 25.0
                    avgPriceBrl = 25.0
                    totalCost = 250.0
                    totalCostBrl = 250.0
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 25.0
                    fees = 0.0
                    priceBrl = 25.0
                    feesBrl = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                DividendEntity.new {
                    assetId = "PETR4"
                    type = "DIVIDENDO"
                    date = LocalDate.of(2024, 6, 15)
                    totalAmount = 50.0
                    taxWithheld = 0.0
                    totalAmountBrl = 50.0
                    taxWithheldBrl = 0.0
                }
            }

            mockMvc
                .perform(get("/portfolio/api"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.dividendPnl").value(50.0))
                .andExpect(jsonPath("$.positions[0].dividendPnl").value(50.0))
        }

        test("portfolio api dividend pnl is zero when no dividends") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                    hasPosition = true
                    quantity = 10.0
                    avgPrice = 25.0
                    avgPriceBrl = 25.0
                    totalCost = 250.0
                    totalCostBrl = 250.0
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 25.0
                    fees = 0.0
                    priceBrl = 25.0
                    feesBrl = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
            }

            mockMvc
                .perform(get("/portfolio/api"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.dividendPnl").value(0.0))
                .andExpect(jsonPath("$.positions[0].dividendPnl").value(0.0))
        }

        // --- Edit Dividend Tests ---

        test("edit dividend via form updates data") {
            val divId =
                transaction {
                    AssetEntity.new("PETR4") {
                        name = "Petrobras"
                        type = "STOCK"
                        currency = "BRL"
                    }
                    DividendEntity
                        .new {
                            assetId = "PETR4"
                            type = "DIVIDENDO"
                            date = LocalDate.of(2024, 3, 10)
                            totalAmount = 50.0
                            taxWithheld = 0.0
                        }.id.value
                }

            mockMvc
                .perform(
                    post("/dividends/$divId/edit")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("type", "JCP")
                        .param("total_amount", "75.0")
                        .param("tax_withheld", "11.25")
                        .param("date", "2024-06-15")
                        .param("notes", "pagamento JCP")
                ).andExpect(status().is3xxRedirection)
                .andExpect(redirectedUrl("/dividends/"))

            transaction {
                val div = DividendEntity.findById(divId)!!
                div.type shouldBe "JCP"
                div.totalAmount shouldBe 75.0
                div.taxWithheld shouldBe 11.25
                div.notes shouldBe "pagamento JCP"
            }
        }

        test("edit dividend with returnTo redirects correctly") {
            val divId =
                transaction {
                    AssetEntity.new("PETR4") {
                        name = "Petrobras"
                        type = "STOCK"
                        currency = "BRL"
                    }
                    DividendEntity
                        .new {
                            assetId = "PETR4"
                            type = "DIVIDENDO"
                            date = LocalDate.of(2024, 3, 10)
                            totalAmount = 50.0
                            taxWithheld = 0.0
                        }.id.value
                }

            mockMvc
                .perform(
                    post("/dividends/$divId/edit")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("type", "DIVIDENDO")
                        .param("total_amount", "50.0")
                        .param("tax_withheld", "0.0")
                        .param("date", "2024-03-10")
                        .param("returnTo", "/assets/PETR4")
                ).andExpect(status().is3xxRedirection)
                .andExpect(redirectedUrl("/assets/PETR4"))
        }
    })
