package com.stocks.controller

import com.stocks.model.AssetEntity
import com.stocks.model.TransactionEntity
import com.stocks.model.Transactions
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.shouldBe
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
class TransactionControllerTest(
    private val mockMvc: MockMvc,
) : FunSpec({

    extensions(SpringExtension)

    beforeEach {
        transaction {
            TransactionEntity.all().forEach { it.delete() }
            AssetEntity.all().forEach { it.delete() }
        }
    }

    test("create transaction api invalid asset returns 404") {
        mockMvc.perform(
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

        mockMvc.perform(
            post("/transactions/api")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"assetId":"PETR4","type":"BUY","quantity":10.0,"price":25.0,"date":"2024-01-01"}""")
        ).andExpect(status().isCreated)
            .andExpect(jsonPath("$.type").value("BUY"))
            .andExpect(jsonPath("$.quantity").value(10.0))
    }

    test("list transactions api filter by asset") {
        transaction {
            AssetEntity.new("PETR4") { name = "Petrobras"; type = "STOCK"; currency = "BRL" }
            AssetEntity.new("VALE3") { name = "Vale"; type = "STOCK"; currency = "BRL" }

            TransactionEntity.new {
                assetId = "PETR4"; type = "BUY"; quantity = 10.0; price = 25.0; fees = 0.0
                date = LocalDate.of(2024, 1, 1)
            }
            TransactionEntity.new {
                assetId = "VALE3"; type = "BUY"; quantity = 5.0; price = 60.0; fees = 0.0
                date = LocalDate.of(2024, 1, 1)
            }
        }

        mockMvc.perform(get("/transactions/api?ticker=PETR4"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].assetId").value("PETR4"))
    }

    test("delete transaction api success") {
        val txId = transaction {
            AssetEntity.new("PETR4") { name = "Petrobras"; type = "STOCK"; currency = "BRL" }
            val tx = TransactionEntity.new {
                assetId = "PETR4"; type = "BUY"; quantity = 10.0; price = 25.0; fees = 0.0
                date = LocalDate.of(2024, 1, 1)
            }
            tx.id.value
        }

        mockMvc.perform(delete("/transactions/api/$txId"))
            .andExpect(status().isNoContent)
    }

    test("delete transaction api not found") {
        mockMvc.perform(delete("/transactions/api/9999"))
            .andExpect(status().isNotFound)
    }
})
