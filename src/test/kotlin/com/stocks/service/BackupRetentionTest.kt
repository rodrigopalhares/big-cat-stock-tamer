package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import java.time.LocalDate

class BackupRetentionTest :
    FunSpec({

        test("daily name carries the full date") {
            BackupRetention.dailyName(LocalDate.of(2026, 6, 9)) shouldBe "stocks-2026-06-09.zip"
        }

        test("monthly name carries only year and month, zero padded") {
            BackupRetention.monthlyName(LocalDate.of(2026, 6, 9)) shouldBe "stocks-2026-06.zip"
        }

        test("no names means nothing to remove") {
            BackupRetention.excess(emptyList(), 7) shouldBe emptyList()
        }

        test("below the limit nothing is removed") {
            val names = listOf("stocks-2026-06-07.zip", "stocks-2026-06-08.zip")
            BackupRetention.excess(names, 7) shouldBe emptyList()
        }

        test("removes the oldest ones, keeping the most recent") {
            val names = (1..9).map { "stocks-2026-06-%02d.zip".format(it) }
            // Keeps the 7 most recent (03..09); removes the 2 oldest (01, 02).
            BackupRetention.excess(names, 7) shouldBe listOf("stocks-2026-06-01.zip", "stocks-2026-06-02.zip")
        }

        test("result does not depend on the input order") {
            val names = listOf("stocks-2026-06-09.zip", "stocks-2026-06-01.zip", "stocks-2026-06-05.zip")
            BackupRetention.excess(names, 2) shouldBe listOf("stocks-2026-06-01.zip")
        }

        test("monthly retention keeps the last 3 months") {
            val names = listOf("stocks-2026-04.zip", "stocks-2026-05.zip", "stocks-2026-06.zip", "stocks-2026-07.zip")
            BackupRetention.excess(names, 3) shouldBe listOf("stocks-2026-04.zip")
        }

        test("keeping zero removes everything") {
            val names = listOf("stocks-2026-06-08.zip", "stocks-2026-06-09.zip")
            BackupRetention.excess(names, 0) shouldBe names.sorted()
        }
    })
