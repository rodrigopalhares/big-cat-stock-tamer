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
class TransactionControllerTest(
    private val mockMvc: MockMvc,
) : FunSpec({

        beforeEach {
            transaction {
                DividendEntity.all().forEach { it.delete() }
                TransactionEntity.all().forEach { it.delete() }
                AssetEntity.all().forEach { it.delete() }
            }
        }

        test("create transaction api invalid asset returns 404") {
            mockMvc
                .perform(
                    post("/transactions/api")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""{"assetId":"NONEXISTENT","type":"BUY","quantity":10.0,"price":10.0,"date":"2024-01-01"}""")
                ).andExpect(status().isNotFound)
        }

        test("create transaction api success") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/transactions/api")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""{"assetId":"PETR4","type":"BUY","quantity":10.0,"price":25.0,"date":"2024-01-01"}""")
                ).andExpect(status().isCreated)
                .andExpect(jsonPath("$.type").value("BUY"))
                .andExpect(jsonPath("$.quantity").value(10.0))
        }

        test("list transactions api filter by asset") {
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
                    price = 25.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "VALE3"
                    type = "BUY"
                    quantity = 5.0
                    price = 60.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
            }

            mockMvc
                .perform(get("/transactions/api?ticker=PETR4"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].assetId").value("PETR4"))
        }

        test("delete transaction api success") {
            val txId =
                transaction {
                    AssetEntity.new("PETR4") {
                        name = "Petrobras"
                        type = "STOCK"
                        currency = "BRL"
                    }
                    val tx =
                        TransactionEntity.new {
                            assetId = "PETR4"
                            type = "BUY"
                            quantity = 10.0
                            price = 25.0
                            fees = 0.0
                            date = LocalDate.of(2024, 1, 1)
                        }
                    tx.id.value
                }

            mockMvc
                .perform(delete("/transactions/api/$txId"))
                .andExpect(status().isNoContent)
        }

        test("delete transaction api not found") {
            mockMvc
                .perform(delete("/transactions/api/9999"))
                .andExpect(status().isNotFound)
        }

        // --- CSV Batch Import Tests ---

        test("parse csv returns html fragment with asset review table") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/transactions/parse-csv")
                        .param("csv", "PETR4\t01/06/2024\tC\t100\t25,50\t10,00\tXP\t0\tBRL\t")
                ).andExpect(status().isOk)
                .andExpect(content().string(org.hamcrest.Matchers.containsString("csvAssetTable")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("PETR4")))
        }

        test("parse csv step2 returns transaction preview") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/transactions/parse-csv-step2")
                        .param("csv", "PETR4\t01/06/2024\tC\t100\t25,50\t10,00\tXP\t0\tBRL\t")
                ).andExpect(status().isOk)
                .andExpect(content().string(org.hamcrest.Matchers.containsString("csvPreviewTable")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("PETR4")))
        }

        test("parse csv step2 with invalid date returns error indicator") {
            mockMvc
                .perform(
                    post("/transactions/parse-csv-step2")
                        .param("csv", "PETR4\t2024-06-01\tC\t100\t25,50\t0\tXP\t0\tBRL\t")
                ).andExpect(status().isOk)
                .andExpect(content().string(org.hamcrest.Matchers.containsString("table-danger")))
        }

        test("batch insert creates transactions") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            val body =
                """
                {
                    "rows": [
                        {
                            "ticker": "PETR4",
                            "date": "2024-06-01",
                            "type": "BUY",
                            "quantity": 100.0,
                            "price": 25.50,
                            "fees": 10.0,
                            "broker": "XP",
                            "notes": "",
                            "currency": "BRL"
                        }
                    ]
                }
                """.trimIndent()

            mockMvc
                .perform(
                    post("/transactions/batch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                ).andExpect(status().isOk)
                .andExpect(jsonPath("$.inserted").value(1))

            val count = transaction { TransactionEntity.all().count() }
            assert(count == 1L) { "Expected 1 transaction, got $count" }
        }

        // --- Filter Tests ---

        test("filter transactions by asset type") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                AssetEntity.new("MXRF11") {
                    name = "Maxi Renda"
                    type = "REIT"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 25.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "MXRF11"
                    type = "BUY"
                    quantity = 100.0
                    price = 10.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
            }

            val result =
                mockMvc
                    .perform(get("/transactions/").param("type", "REIT"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "MXRF11</a>"
            body shouldNotContain "PETR4</a>"
        }

        test("filter transactions with position") {
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
                    price = 25.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "VALE3"
                    type = "BUY"
                    quantity = 5.0
                    price = 60.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "VALE3"
                    type = "SELL"
                    quantity = 5.0
                    price = 70.0
                    fees = 0.0
                    date = LocalDate.of(2024, 2, 1)
                }
            }

            val result =
                mockMvc
                    .perform(get("/transactions/").param("position", "with"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "PETR4</a>"
            body shouldNotContain "VALE3</a>"
        }

        test("filter transactions without position") {
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
                    price = 25.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "VALE3"
                    type = "BUY"
                    quantity = 5.0
                    price = 60.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "VALE3"
                    type = "SELL"
                    quantity = 5.0
                    price = 70.0
                    fees = 0.0
                    date = LocalDate.of(2024, 2, 1)
                }
            }

            val result =
                mockMvc
                    .perform(get("/transactions/").param("position", "without"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "VALE3</a>"
            body shouldNotContain "PETR4</a>"
        }

        test("filter transactions by type and position combined") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
                AssetEntity.new("MXRF11") {
                    name = "Maxi Renda"
                    type = "REIT"
                    currency = "BRL"
                }
                AssetEntity.new("HGLG11") {
                    name = "CSHG Log"
                    type = "REIT"
                    currency = "BRL"
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 25.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "MXRF11"
                    type = "BUY"
                    quantity = 100.0
                    price = 10.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "HGLG11"
                    type = "BUY"
                    quantity = 50.0
                    price = 160.0
                    fees = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
                TransactionEntity.new {
                    assetId = "HGLG11"
                    type = "SELL"
                    quantity = 50.0
                    price = 170.0
                    fees = 0.0
                    date = LocalDate.of(2024, 2, 1)
                }
            }

            val result =
                mockMvc
                    .perform(get("/transactions/").param("type", "REIT").param("position", "with"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "MXRF11</a>"
            body shouldNotContain "PETR4</a>"
            body shouldNotContain "HGLG11</a>"
        }

        // --- Edit Transaction Tests ---

        test("edit transaction via form updates data") {
            val txId =
                transaction {
                    AssetEntity.new("PETR4") {
                        name = "Petrobras"
                        type = "STOCK"
                        currency = "BRL"
                    }
                    TransactionEntity
                        .new {
                            assetId = "PETR4"
                            type = "BUY"
                            quantity = 100.0
                            price = 25.0
                            fees = 10.0
                            date = LocalDate.of(2024, 1, 15)
                            broker = "XP"
                        }.id.value
                }

            mockMvc
                .perform(
                    post("/transactions/$txId/edit")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("type", "SELL")
                        .param("quantity", "50.0")
                        .param("price", "30.0")
                        .param("fees", "5.0")
                        .param("date", "2024-06-01")
                        .param("broker", "Clear")
                        .param("notes", "venda parcial")
                ).andExpect(status().is3xxRedirection)
                .andExpect(redirectedUrl("/transactions/"))

            transaction {
                val tx = TransactionEntity.findById(txId)!!
                tx.type shouldBe "SELL"
                tx.quantity shouldBe 50.0
                tx.price shouldBe 30.0
                tx.fees shouldBe 5.0
                tx.broker shouldBe "Clear"
                tx.notes shouldBe "venda parcial"
            }
        }

        test("edit transaction with returnTo redirects correctly") {
            val txId =
                transaction {
                    AssetEntity.new("PETR4") {
                        name = "Petrobras"
                        type = "STOCK"
                        currency = "BRL"
                    }
                    TransactionEntity
                        .new {
                            assetId = "PETR4"
                            type = "BUY"
                            quantity = 100.0
                            price = 25.0
                            fees = 0.0
                            date = LocalDate.of(2024, 1, 15)
                        }.id.value
                }

            mockMvc
                .perform(
                    post("/transactions/$txId/edit")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("type", "BUY")
                        .param("quantity", "100.0")
                        .param("price", "26.0")
                        .param("fees", "0.0")
                        .param("date", "2024-01-15")
                        .param("returnTo", "/assets/PETR4")
                ).andExpect(status().is3xxRedirection)
                .andExpect(redirectedUrl("/assets/PETR4"))
        }
    })
