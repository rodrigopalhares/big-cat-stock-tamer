package com.stocks.service

import com.stocks.dto.AssetStatus
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.shouldBeExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.mockk.mockk

class CsvParsingServiceTest :
    FunSpec({

        val service = CsvParsingService(mockk(), mockk())
        val existingTickers = setOf("PETR4", "VALE3")
        val resolver: (String) -> AssetStatus = { AssetStatus.WILL_CREATE }

        context("parseBrazilianNumber") {
            test("simple decimal with comma") {
                parseBrazilianNumber("25,50") shouldBe 25.50
            }

            test("thousands separator with dot") {
                parseBrazilianNumber("1.234,56") shouldBe 1234.56
            }

            test("integer without separator") {
                parseBrazilianNumber("100") shouldBe 100.0
            }

            test("blank string returns zero") {
                parseBrazilianNumber("") shouldBe 0.0
                parseBrazilianNumber("   ") shouldBe 0.0
            }

            test("trims whitespace") {
                parseBrazilianNumber("  25,50  ") shouldBe 25.50
            }

            test("invalid input returns null") {
                parseBrazilianNumber("abc").shouldBeNull()
            }

            test("negative number") {
                parseBrazilianNumber("-100,50") shouldBe -100.50
            }

            test("large number with multiple thousands separators") {
                parseBrazilianNumber("1.000.000,00") shouldBe 1000000.0
            }
        }

        context("parseCsvRows") {
            test("parse valid BUY row") {
                val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t10,00\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                val row = rows[0]
                row.ticker shouldBe "PETR4"
                row.date shouldBe "2024-06-01"
                row.type shouldBe "BUY"
                row.quantity shouldBeExactly 100.0
                row.price shouldBeExactly 25.50
                row.fees shouldBeExactly 10.0
                row.broker shouldBe "XP"
                row.currency shouldBe "BRL"
                row.assetStatus shouldBe AssetStatus.EXISTS
                row.error.shouldBeNull()
            }

            test("parse valid SELL row") {
                val csv = "VALE3\t15/03/2024\tV\t50\t60,00\t5,00\tClear\t0\tBRL\tvenda parcial"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                val row = rows[0]
                row.type shouldBe "SELL"
                row.notes shouldBe "venda parcial"
                row.assetStatus shouldBe AssetStatus.EXISTS
            }

            test("IRRF appended to notes") {
                val csv = "PETR4\t01/06/2024\tV\t100\t30,00\t10,00\tXP\t2,31\tBRL\tvenda"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                val row = rows[0]
                row.fees shouldBeExactly 12.31
                row.notes shouldContain "IRRF: 2,31"
                row.notes shouldContain "venda"
            }

            test("IRRF appended to empty notes") {
                val csv = "PETR4\t01/06/2024\tV\t100\t30,00\t10,00\tXP\t5,00\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].notes shouldBe "IRRF: 5,00"
            }

            test("negative quantity converted to absolute value then negated for SELL") {
                val csv = "PETR4\t01/06/2024\tV\t-100\t30,00\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].quantity shouldBeExactly -100.0
            }

            test("invalid date returns error row") {
                val csv = "PETR4\t2024-06-01\tC\t100\t25,50\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].error shouldContain "Data inválida"
            }

            test("blank lines are skipped") {
                val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t\n\n\nVALE3\t02/06/2024\tC\t50\t60,00\t0\tClear\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 2
                rows[0].ticker shouldBe "PETR4"
                rows[1].ticker shouldBe "VALE3"
            }

            test("unknown ticker gets WILL_CREATE status from resolver") {
                val csv = "GRND3\t01/06/2024\tC\t100\t5,00\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, setOf("PETR4"), resolver)

                rows shouldHaveSize 1
                rows[0].assetStatus shouldBe AssetStatus.WILL_CREATE
            }

            test("existing ticker gets EXISTS status") {
                val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows[0].assetStatus shouldBe AssetStatus.EXISTS
            }

            test("resolver called only once per unique unknown ticker") {
                var callCount = 0
                val countingResolver: (String) -> AssetStatus = {
                    callCount++
                    AssetStatus.WILL_CREATE
                }

                val csv = "GRND3\t01/06/2024\tC\t100\t5,00\t0\tXP\t0\tBRL\t\nGRND3\t02/06/2024\tC\t200\t5,50\t0\tXP\t0\tBRL\t"
                service.parseCsvRows(csv, emptySet(), countingResolver)

                callCount shouldBe 1
            }

            test("Brazilian number format with thousands separator") {
                val csv = "PETR4\t01/06/2024\tC\t1.000\t1.234,56\t10,00\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].quantity shouldBeExactly 1000.0
                rows[0].price shouldBeExactly 1234.56
            }

            test("insufficient columns returns error") {
                val csv = "PETR4\t01/06/2024\tC"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].error shouldContain "Colunas insuficientes"
            }

            test("invalid type returns error") {
                val csv = "PETR4\t01/06/2024\tX\t100\t25,50\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].error shouldContain "Tipo inválido"
            }

            test("empty csv returns empty list") {
                service.parseCsvRows("", existingTickers, resolver).shouldBeEmpty()
                service.parseCsvRows("  \n  \n  ", existingTickers, resolver).shouldBeEmpty()
            }

            test("blank ticker returns error row") {
                val csv = " \t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].error shouldContain "Ticker vazio"
            }

            test("zero quantity returns error row") {
                val csv = "PETR4\t01/06/2024\tC\t0\t25,50\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].error shouldContain "Quantidade deve ser > 0"
            }

            test("zero price returns error row") {
                val csv = "PETR4\t01/06/2024\tC\t100\t0\t0\tXP\t0\tBRL\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].error shouldContain "Preço deve ser > 0"
            }

            test("invalid currency defaults to BRL") {
                val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tEUR\t"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].currency shouldBe "BRL"
            }

            test("USD currency is accepted") {
                val csv = "AAPL\t01/06/2024\tC\t10\t150,00\t0\tIBKR\t0\tUSD\t"
                val rows = service.parseCsvRows(csv, emptySet(), resolver)

                rows shouldHaveSize 1
                rows[0].currency shouldBe "USD"
            }

            test("BUY and SELL types accepted in English") {
                val buyRow = "PETR4\t01/06/2024\tBUY\t100\t25,50\t0\tXP\t0\tBRL\t"
                val sellRow = "PETR4\t01/06/2024\tSELL\t100\t25,50\t0\tXP\t0\tBRL\t"

                service.parseCsvRows(buyRow, existingTickers, resolver)[0].type shouldBe "BUY"
                service.parseCsvRows(sellRow, existingTickers, resolver)[0].type shouldBe "SELL"
            }

            test("missing optional columns use defaults") {
                val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP"
                val rows = service.parseCsvRows(csv, existingTickers, resolver)

                rows shouldHaveSize 1
                rows[0].error.shouldBeNull()
                rows[0].currency shouldBe "BRL"
                rows[0].notes shouldBe ""
            }
        }
    })
