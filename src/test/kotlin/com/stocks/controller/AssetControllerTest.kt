package com.stocks.controller

import com.stocks.model.AssetEntity
import com.stocks.model.DividendEntity
import com.stocks.model.TransactionEntity
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import java.time.LocalDate

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AssetControllerTest(
    private val mockMvc: MockMvc,
) : FunSpec({

        extensions(SpringExtension)

        beforeEach {
            transaction {
                DividendEntity.all().forEach { it.delete() }
                TransactionEntity.all().forEach { it.delete() }
                AssetEntity.all().forEach { it.delete() }
            }
        }

        test("list assets page returns 200") {
            mockMvc
                .perform(get("/assets/"))
                .andExpect(status().isOk)
        }

        test("create asset via form success") {
            mockMvc
                .perform(
                    post("/assets/new")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("ticker", "PETR4")
                        .param("name", "Petrobras")
                        .param("type", "STOCK")
                        .param("currency", "BRL")
                ).andExpect(status().is3xxRedirection)

            val asset = transaction { AssetEntity.findById("PETR4") }
            asset shouldBe asset // exists
        }

        test("create asset via form duplicate stays on page") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            val result =
                mockMvc
                    .perform(
                        post("/assets/new")
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .param("ticker", "PETR4")
                            .param("name", "Petrobras")
                            .param("type", "STOCK")
                            .param("currency", "BRL")
                    ).andExpect(status().isOk)
                    .andReturn()

            result.response.contentAsString shouldContain "já cadastrado"
        }

        test("list assets api empty") {
            mockMvc
                .perform(get("/assets/api"))
                .andExpect(status().isOk)
                .andExpect(content().json("[]"))
        }

        test("create asset api success") {
            mockMvc
                .perform(
                    post("/assets/api")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""{"ticker":"PETR4","name":"Petrobras","type":"STOCK","currency":"BRL"}""")
                ).andExpect(status().isCreated)
                .andExpect(jsonPath("$.ticker").value("PETR4"))
        }

        test("create asset api duplicate returns 409") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/assets/api")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""{"ticker":"PETR4","name":"Petrobras","type":"STOCK","currency":"BRL"}""")
                ).andExpect(status().isConflict)
        }

        test("get asset api not found") {
            mockMvc
                .perform(get("/assets/api/NONEXISTENT"))
                .andExpect(status().isNotFound)
        }

        test("delete asset via form") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(post("/assets/PETR4/delete"))
                .andExpect(status().is3xxRedirection)

            val deleted = transaction { AssetEntity.findById("PETR4") }
            deleted shouldBe null
        }

        test("edit asset via form") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(
                    post("/assets/PETR4/edit")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("name", "Petrobras Novo")
                        .param("type", "REIT")
                        .param("currency", "USD")
                        .param("yf_ticker", "")
                ).andExpect(status().is3xxRedirection)

            val updated = transaction { AssetEntity.findById("PETR4")!! }
            transaction {
                updated.name shouldBe "Petrobras Novo"
                updated.type shouldBe "REIT"
                updated.currency shouldBe "USD"
            }
        }

        // --- Filter Tests ---

        test("filter assets by type") {
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
            }

            val result =
                mockMvc
                    .perform(get("/assets/").param("type", "REIT"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "<td class=\"fw-bold\">MXRF11</td>"
            body shouldNotContain "<td class=\"fw-bold\">PETR4</td>"
        }

        test("filter assets with position") {
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
            }

            val result =
                mockMvc
                    .perform(get("/assets/").param("position", "with"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "<td class=\"fw-bold\">PETR4</td>"
            body shouldNotContain "<td class=\"fw-bold\">VALE3</td>"
        }

        test("filter assets without position") {
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
            }

            val result =
                mockMvc
                    .perform(get("/assets/").param("position", "without"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "<td class=\"fw-bold\">VALE3</td>"
            body shouldNotContain "<td class=\"fw-bold\">PETR4</td>"
        }

        test("filter assets by type and position combined") {
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
            }

            val result =
                mockMvc
                    .perform(get("/assets/").param("type", "REIT").param("position", "with"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "<td class=\"fw-bold\">MXRF11</td>"
            body shouldNotContain "<td class=\"fw-bold\">PETR4</td>"
            body shouldNotContain "<td class=\"fw-bold\">HGLG11</td>"
        }

        test("no filters returns all assets") {
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
            }

            val result =
                mockMvc
                    .perform(get("/assets/"))
                    .andExpect(status().isOk)
                    .andReturn()

            val body = result.response.contentAsString
            body shouldContain "<td class=\"fw-bold\">PETR4</td>"
            body shouldContain "<td class=\"fw-bold\">MXRF11</td>"
        }
    })
