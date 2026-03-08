package com.stocks.controller

import com.ninjasquad.springmockk.MockkBean
import com.stocks.model.*
import com.stocks.service.QuoteService
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.string.shouldContain
import io.mockk.every
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import java.time.LocalDate

@ApplyExtension(SpringExtension::class)
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MonthlyEvolutionControllerTest(
    private val mockMvc: MockMvc,
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

        test("GET /evolution/ returns 200") {
            mockMvc
                .perform(get("/evolution/"))
                .andExpect(status().isOk)
        }

        test("GET /evolution/ shows empty state when no data") {
            val result =
                mockMvc
                    .perform(get("/evolution/"))
                    .andExpect(status().isOk)
                    .andReturn()

            result.response.contentAsString shouldContain "Nenhum dado"
        }

        test("GET /evolution/api returns empty JSON") {
            mockMvc
                .perform(get("/evolution/api"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.months").isEmpty)
                .andExpect(jsonPath("$.tickers").isEmpty)
        }

        test("POST /evolution/recalculate redirects") {
            mockMvc
                .perform(post("/evolution/recalculate"))
                .andExpect(status().is3xxRedirection)
        }

        test("POST /evolution/api/recalculate returns ok") {
            mockMvc
                .perform(post("/evolution/api/recalculate"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.status").value("ok"))
        }

        test("GET /evolution/api returns data after recalculate") {
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

            mockMvc.perform(post("/evolution/api/recalculate"))

            mockMvc
                .perform(get("/evolution/api"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.tickers[0]").value("PETR4"))
                .andExpect(jsonPath("$.months[0].totalInvested").value(300.0))
                .andExpect(jsonPath("$.months[0].totalMarketValue").value(320.0))
        }

        test("GET /evolution/ shows table after recalculate") {
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

            mockMvc.perform(post("/evolution/recalculate"))

            val result =
                mockMvc
                    .perform(get("/evolution/"))
                    .andExpect(status().isOk)
                    .andReturn()

            result.response.contentAsString shouldContain "PETR4"
            result.response.contentAsString shouldContain "320"
        }
    })
