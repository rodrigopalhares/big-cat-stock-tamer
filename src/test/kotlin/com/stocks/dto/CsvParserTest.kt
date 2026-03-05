package com.stocks.dto

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.doubles.shouldBeExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain

class CsvParserTest :
    FunSpec({

        val existingTickers = setOf("PETR4", "VALE3")
        val resolver: (String) -> AssetStatus = { AssetStatus.WILL_CREATE }

        test("parse valid BUY row") {
            val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t10,00\tXP\t0\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
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
            row.error shouldBe null
        }

        test("parse valid SELL row") {
            val csv = "VALE3\t15/03/2024\tV\t50\t60,00\t5,00\tClear\t0\tBRL\tvenda parcial"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            val row = rows[0]
            row.type shouldBe "SELL"
            row.notes shouldBe "venda parcial"
            row.assetStatus shouldBe AssetStatus.EXISTS
        }

        test("IRRF appended to notes") {
            val csv = "PETR4\t01/06/2024\tV\t100\t30,00\t10,00\tXP\t2,31\tBRL\tvenda"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            val row = rows[0]
            row.fees shouldBeExactly 12.31
            row.notes shouldContain "IRRF: 2,31"
            row.notes shouldContain "venda"
        }

        test("IRRF appended to empty notes") {
            val csv = "PETR4\t01/06/2024\tV\t100\t30,00\t10,00\tXP\t5,00\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            rows[0].notes shouldBe "IRRF: 5,00"
        }

        test("negative quantity converted to absolute value") {
            val csv = "PETR4\t01/06/2024\tV\t-100\t30,00\t0\tXP\t0\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            rows[0].quantity shouldBeExactly 100.0
        }

        test("invalid date returns error row") {
            val csv = "PETR4\t2024-06-01\tC\t100\t25,50\t0\tXP\t0\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            rows[0].error shouldContain "Data inválida"
        }

        test("blank lines are skipped") {
            val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t\n\n\nVALE3\t02/06/2024\tC\t50\t60,00\t0\tClear\t0\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 2
            rows[0].ticker shouldBe "PETR4"
            rows[1].ticker shouldBe "VALE3"
        }

        test("unknown ticker gets WILL_CREATE status from resolver") {
            val csv = "GRND3\t01/06/2024\tC\t100\t5,00\t0\tXP\t0\tBRL\t"
            val rows = parseCsvRows(csv, setOf("PETR4"), resolver)

            rows.size shouldBe 1
            rows[0].assetStatus shouldBe AssetStatus.WILL_CREATE
        }

        test("existing ticker gets EXISTS status") {
            val csv = "PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows[0].assetStatus shouldBe AssetStatus.EXISTS
        }

        test("resolver called only once per unique unknown ticker") {
            var callCount = 0
            val countingResolver: (String) -> AssetStatus = {
                callCount++
                AssetStatus.WILL_CREATE
            }

            val csv = "GRND3\t01/06/2024\tC\t100\t5,00\t0\tXP\t0\tBRL\t\nGRND3\t02/06/2024\tC\t200\t5,50\t0\tXP\t0\tBRL\t"
            parseCsvRows(csv, emptySet(), countingResolver)

            callCount shouldBe 1
        }

        test("Brazilian number format with thousands separator") {
            val csv = "PETR4\t01/06/2024\tC\t1.000\t1.234,56\t10,00\tXP\t0\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            rows[0].quantity shouldBeExactly 1000.0
            rows[0].price shouldBeExactly 1234.56
        }

        test("insufficient columns returns error") {
            val csv = "PETR4\t01/06/2024\tC"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            rows[0].error shouldContain "Colunas insuficientes"
        }

        test("invalid type returns error") {
            val csv = "PETR4\t01/06/2024\tX\t100\t25,50\t0\tXP\t0\tBRL\t"
            val rows = parseCsvRows(csv, existingTickers, resolver)

            rows.size shouldBe 1
            rows[0].error shouldContain "Tipo inválido"
        }
    })
