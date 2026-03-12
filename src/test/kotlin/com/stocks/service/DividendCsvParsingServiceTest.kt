package com.stocks.service

import com.stocks.clearAllData
import com.stocks.createAsset
import com.stocks.dto.DividendBatchRequest
import com.stocks.dto.DividendBatchRowRequest
import com.stocks.model.DividendEntity
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.ActiveProfiles

@ApplyExtension(SpringExtension::class)
@SpringBootTest
@ActiveProfiles("test")
class DividendCsvParsingServiceTest(
    private val dividendCsvParsingService: DividendCsvParsingService,
) : FunSpec({

        beforeEach {
            clearAllData()
        }

        test("parse valid dividend CSV rows") {
            createAsset("PETR4")
            createAsset("VALE3")

            val csv =
                "PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP\t\tTeste\n" +
                    "VALE3\t15/02/2026\tJCP\t2,30\t0,35\tBRL\tClear"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)

            rows shouldHaveSize 2

            rows[0].ticker shouldBe "PETR4"
            rows[0].date shouldBe "2026-03-01"
            rows[0].type shouldBe "DIVIDENDO"
            rows[0].totalAmount shouldBe (1.50 plusOrMinus 0.001)
            rows[0].taxWithheld shouldBe (0.0 plusOrMinus 0.001)
            rows[0].currency shouldBe "BRL"
            rows[0].broker shouldBe "XP"
            rows[0].notes shouldBe "Teste"
            rows[0].error shouldBe null

            rows[1].ticker shouldBe "VALE3"
            rows[1].date shouldBe "2026-02-15"
            rows[1].type shouldBe "JCP"
            rows[1].totalAmount shouldBe (2.30 plusOrMinus 0.001)
            rows[1].taxWithheld shouldBe (0.35 plusOrMinus 0.001)
            rows[1].error shouldBe null
        }

        test("error when insufficient columns") {
            val csv = "PETR4\t01/03/2026\tDIVIDENDO"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].error shouldContain "Colunas insuficientes"
        }

        test("error when ticker is empty") {
            val csv = "\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].error shouldContain "Ticker vazio"
        }

        test("error when date is invalid") {
            createAsset("PETR4")
            val csv = "PETR4\t99/99/9999\tDIVIDENDO\t1,50\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].error shouldContain "Data inválida"
        }

        test("error when type is unknown but valid fields are filled") {
            createAsset("PETR4")
            val csv = "PETR4\t01/03/2026\tUNKNOWN_TYPE\t1,50\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].error shouldContain "Tipo desconhecido"
            rows[0].date shouldBe "2026-03-01"
            rows[0].totalAmount shouldBe (1.50 plusOrMinus 0.001)
            rows[0].ticker shouldBe "PETR4"
        }

        test("error when totalAmount is zero or negative") {
            createAsset("PETR4")
            val csv = "PETR4\t01/03/2026\tDIVIDENDO\t0,00\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].error shouldContain "Valor deve ser > 0"
        }

        test("error when asset does not exist but valid fields are filled") {
            val csv = "XXXX9\t01/03/2026\tDIVIDENDO\t1,00\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].error shouldContain "Ativo não cadastrado"
            rows[0].date shouldBe "2026-03-01"
            rows[0].type shouldBe "DIVIDENDO"
            rows[0].totalAmount shouldBe (1.0 plusOrMinus 0.001)
        }

        test("multiple errors accumulated in same row") {
            val csv = "XXXX9\t99/99/9999\tUNKNOWN\tabc\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            val row = rows[0]
            row.error shouldContain "Data inválida"
            row.error shouldContain "Tipo desconhecido"
            row.error shouldContain "Valor inválido"
            row.error shouldContain "Ativo não cadastrado"
            row.ticker shouldBe "XXXX9"
            row.broker shouldBe "XP"
        }

        test("type aliases are resolved case-insensitively") {
            createAsset("PETR4")

            val csv = "PETR4\t01/03/2026\tjscp\t1,50\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].type shouldBe "JCP"
            rows[0].error shouldBe null
        }

        test("DIVIDENDOS alias maps to DIVIDENDO") {
            createAsset("PETR4")
            val csv = "PETR4\t01/03/2026\tDividendos\t1,50\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].type shouldBe "DIVIDENDO"
            rows[0].error shouldBe null
        }

        test("RENDIMENTOS alias maps to RENDIMENTO") {
            createAsset("MXRF11")
            val csv = "MXRF11\t01/03/2026\tRendimentos\t0,80\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].type shouldBe "RENDIMENTO"
            rows[0].error shouldBe null
        }

        test("Brazilian number parsing works for amounts") {
            createAsset("PETR4")
            val csv = "PETR4\t01/03/2026\tDIVIDENDO\t1.234,56\t100,50\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].totalAmount shouldBe (1234.56 plusOrMinus 0.001)
            rows[0].taxWithheld shouldBe (100.50 plusOrMinus 0.001)
            rows[0].error shouldBe null
        }

        test("IRRF defaults to 0 when empty") {
            createAsset("PETR4")
            val csv = "PETR4\t01/03/2026\tDIVIDENDO\t1,50\t\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].taxWithheld shouldBe (0.0 plusOrMinus 0.001)
            rows[0].error shouldBe null
        }

        test("column 8 (ignorar) is skipped") {
            createAsset("PETR4")
            val csv = "PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP\tqualquer coisa\tNota real"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].notes shouldBe "Nota real"
            rows[0].error shouldBe null
        }

        test("invalid currency defaults to BRL") {
            createAsset("PETR4")
            val csv = "PETR4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tEUR\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].currency shouldBe "BRL"
            rows[0].error shouldBe null
        }

        test("batch import creates dividends in database") {
            createAsset("PETR4")
            createAsset("VALE3")

            val request =
                DividendBatchRequest(
                    rows =
                        listOf(
                            DividendBatchRowRequest(
                                ticker = "PETR4",
                                date = "2026-03-01",
                                type = "DIVIDENDO",
                                totalAmount = 1.50,
                                taxWithheld = 0.0,
                                currency = "BRL",
                                broker = "XP",
                                notes = "Teste",
                            ),
                            DividendBatchRowRequest(
                                ticker = "VALE3",
                                date = "2026-02-15",
                                type = "JCP",
                                totalAmount = 2.30,
                                taxWithheld = 0.35,
                                currency = "BRL",
                                broker = "Clear",
                                notes = "",
                            ),
                        ),
                )

            val inserted = dividendCsvParsingService.batchImportDividends(request)
            inserted shouldBe 2

            val dividends = transaction { DividendEntity.all().toList() }
            dividends shouldHaveSize 2
        }

        test("empty CSV returns empty list") {
            val rows = dividendCsvParsingService.parseDividendCsvRows("")
            rows shouldHaveSize 0
        }

        test("ticker is normalized to uppercase") {
            createAsset("PETR4")
            val csv = "petr4\t01/03/2026\tDIVIDENDO\t1,50\t0,00\tBRL\tXP"

            val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
            rows shouldHaveSize 1
            rows[0].ticker shouldBe "PETR4"
            rows[0].error shouldBe null
        }
    })
