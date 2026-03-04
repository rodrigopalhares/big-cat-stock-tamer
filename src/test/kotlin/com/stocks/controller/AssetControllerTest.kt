package com.stocks.controller

import com.stocks.model.AssetEntity
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AssetControllerTest(
    private val mockMvc: MockMvc,
) : FunSpec({

        extensions(SpringExtension)

        beforeEach {
            transaction {
                // Clean up test data
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
    })
