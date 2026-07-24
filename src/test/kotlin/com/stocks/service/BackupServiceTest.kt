package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDate
import java.util.zip.ZipFile
import javax.sql.DataSource
import kotlin.io.path.name

class BackupServiceTest :
    FunSpec({

        val today = LocalDate.of(2026, 6, 9)

        /** A real H2 file database with one row, to act as the backup source. */
        fun fileDataSource(dir: Path): DataSource {
            val dataSource = DriverManagerDataSource("jdbc:h2:file:${dir.resolve("db/stocks")}", "sa", "")
            dataSource.connection.use { connection ->
                connection.createStatement().use { statement ->
                    statement.execute("CREATE TABLE IF NOT EXISTS t (v VARCHAR)")
                    statement.execute("INSERT INTO t (v) VALUES ('ola')")
                }
            }
            return dataSource
        }

        fun newService(
            dir: Path,
            dataSource: DataSource = fileDataSource(dir),
            enabled: Boolean = true,
            dailyCopies: Int = 7,
            monthlyCopies: Int = 3,
        ) = BackupService(dataSource, enabled, dir.resolve("backups").toString(), dailyCopies, monthlyCopies)

        fun tempDir(): Path = Files.createTempDirectory("backup-test")

        fun backupNames(folder: Path): List<String> =
            Files
                .list(folder)
                .use { entries -> entries.map { it.name }.toList() }
                .filter { it.endsWith(".zip") }
                .sorted()

        test("creates a daily and a monthly backup holding the database file") {
            val dir = tempDir()

            newService(dir).ensureBackups(today)

            val daily = dir.resolve("backups/daily/stocks-2026-06-09.zip")
            val monthly = dir.resolve("backups/monthly/stocks-2026-06.zip")
            Files.isRegularFile(daily) shouldBe true
            Files.isRegularFile(monthly) shouldBe true
            // The snapshot is a valid zip carrying the H2 database file.
            listOf(daily, monthly).forEach { backup ->
                ZipFile(backup.toFile()).use { zip ->
                    zip.entries().asSequence().any { it.name.endsWith(".mv.db") } shouldBe true
                }
            }
        }

        test("is idempotent — does not rewrite the backup on the same day") {
            val dir = tempDir()
            val service = newService(dir)
            service.ensureBackups(today)
            val daily = dir.resolve("backups/daily/stocks-2026-06-09.zip")
            // Mark the file; if it gets recreated, the mark disappears.
            Files.write(daily, "MARK".toByteArray())

            service.ensureBackups(today)

            Files.readAllBytes(daily).decodeToString() shouldBe "MARK"
        }

        test("rotates daily backups keeping the configured amount") {
            val dir = tempDir()
            val daily = dir.resolve("backups/daily")
            Files.createDirectories(daily)
            // 8 old backups already on disk.
            (1..8).forEach { day ->
                Files.write(daily.resolve("stocks-2026-06-%02d.zip".format(day)), "old".toByteArray())
            }

            newService(dir).ensureBackups(today) // creates the 9th → 7 must remain

            val names = backupNames(daily)
            names.size shouldBe 7
            names.first() shouldBe "stocks-2026-06-03.zip" // the 2 oldest are gone
            names.last() shouldBe "stocks-2026-06-09.zip"
        }

        test("rotates monthly backups keeping the configured amount") {
            val dir = tempDir()
            val monthly = dir.resolve("backups/monthly")
            Files.createDirectories(monthly)
            listOf(3, 4, 5).forEach { month ->
                Files.write(monthly.resolve("stocks-2026-%02d.zip".format(month)), "old".toByteArray())
            }

            newService(dir).ensureBackups(today) // creates 2026-06 → keeps 3 (04, 05, 06)

            backupNames(monthly) shouldContainExactly
                listOf("stocks-2026-04.zip", "stocks-2026-05.zip", "stocks-2026-06.zip")
        }

        test("backs up while the app holds an open connection (AUTO_SERVER, as in production)") {
            val dir = tempDir()
            val dataSource = DriverManagerDataSource("jdbc:h2:file:${dir.resolve("db/stocks")};AUTO_SERVER=TRUE", "sa", "")
            dataSource.connection.use { connection ->
                connection.createStatement().use { it.execute("CREATE TABLE t (v VARCHAR)") }
            }

            // A live connection, like the app's pool, kept open across the whole backup.
            dataSource.connection.use { open ->
                open.createStatement().use { it.execute("INSERT INTO t (v) VALUES ('ola')") }
                newService(dir, dataSource = dataSource).ensureBackups(today)
            }

            Files.isRegularFile(dir.resolve("backups/daily/stocks-2026-06-09.zip")) shouldBe true
        }

        test("an in-memory database is a no-op") {
            val dir = tempDir()
            val inMemory = DriverManagerDataSource("jdbc:h2:mem:backup-test;DB_CLOSE_DELAY=-1", "sa", "")

            newService(dir, dataSource = inMemory).ensureBackups(today)

            Files.exists(dir.resolve("backups")) shouldBe false
        }

        test("disabling the backup skips everything") {
            val dir = tempDir()

            newService(dir, enabled = false).ensureBackups(today)

            Files.exists(dir.resolve("backups")) shouldBe false
        }
    })
