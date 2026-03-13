package com.stocks.controller

import com.stocks.model.AssetEntity
import com.stocks.model.DividendEntity
import com.stocks.model.TransactionEntity
import com.stocks.service.QuoteService
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
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
class PortfolioControllerTest(
    private val mockMvc: MockMvc,
    private val quoteService: QuoteService,
) : FunSpec({

        beforeEach {
            transaction {
                DividendEntity.all().forEach { it.delete() }
                TransactionEntity.all().forEach { it.delete() }
                AssetEntity.all().forEach { it.delete() }
            }
        }

        test("portfolio api empty") {
            mockMvc
                .perform(get("/portfolio/api"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.positions").isEmpty)
                .andExpect(jsonPath("$.totalInvested").value(0.0))
        }

        test("portfolio api with brl transaction") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                    hasPosition = true
                    quantity = 10.0
                    avgPrice = 10.0
                    avgPriceBrl = 10.0
                    totalCost = 100.0
                    totalCostBrl = 100.0
                }
                TransactionEntity.new {
                    assetId = "PETR4"
                    type = "BUY"
                    quantity = 10.0
                    price = 10.0
                    fees = 0.0
                    priceBrl = 10.0
                    feesBrl = 0.0
                    date = LocalDate.of(2024, 1, 1)
                }
            }

            mockMvc
                .perform(get("/portfolio/api"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.positions.length()").value(1))
                .andExpect(jsonPath("$.totalInvested").value(100.0))
        }

        test("portfolio api ticker not found") {
            mockMvc
                .perform(get("/portfolio/api/PETR4"))
                .andExpect(status().isNotFound)
        }

        test("portfolio api ticker no transactions") {
            transaction {
                AssetEntity.new("PETR4") {
                    name = "Petrobras"
                    type = "STOCK"
                    currency = "BRL"
                }
            }

            mockMvc
                .perform(get("/portfolio/api/PETR4"))
                .andExpect(status().isNotFound)
        }
    })
