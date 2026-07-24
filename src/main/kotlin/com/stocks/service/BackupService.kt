package com.stocks.service

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.LocalDate
import javax.sql.DataSource
import kotlin.io.path.name

/**
 * Automatic backup of the H2 database: consistent snapshot + retention.
 *
 * Runs from the scheduler (on startup and once a day), outside of any request. Uses H2's *online*
 * backup (`BACKUP TO`), which is safe even while the app is writing — it is not a naive file copy,
 * which could grab the database in the middle of a transaction. The retention policy is pure
 * ([BackupRetention]); only the I/O (writing the file, listing, deleting) lives here.
 *
 * Two sets, in subfolders of the configured backup directory:
 * - daily → `daily/stocks-yyyy-MM-dd.zip`, keeps the last `app.backup.daily-copies`.
 * - monthly → `monthly/stocks-yyyy-MM.zip`, keeps the last `app.backup.monthly-copies`.
 *
 * Idempotent per period: the day's/month's backup is only created if it does not exist yet, so
 * restarting the app several times on the same day does not duplicate anything. Only makes sense
 * for a file-based database — an in-memory database (the tests) is a no-op.
 */
@Service
class BackupService(
    private val dataSource: DataSource,
    @Value("\${app.backup.enabled:true}") private val enabled: Boolean,
    @Value("\${app.backup.dir:./data/backups}") backupDirPath: String,
    @Value("\${app.backup.daily-copies:7}") private val dailyCopies: Int,
    @Value("\${app.backup.monthly-copies:3}") private val monthlyCopies: Int,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val backupDir: Path = Path.of(backupDirPath)

    /** Ensures the daily and monthly backups for [today] exist (idempotent) and rotates old ones. */
    fun ensureBackups(today: LocalDate = LocalDate.now()) {
        if (!enabled) {
            logger.debug("Backup is disabled (app.backup.enabled=false)")
            return
        }
        if (!isFileDatabase()) {
            logger.debug("In-memory database — nothing to back up")
            return
        }
        ensure(backupDir.resolve("daily"), BackupRetention.dailyName(today), dailyCopies)
        ensure(backupDir.resolve("monthly"), BackupRetention.monthlyName(today), monthlyCopies)
    }

    /** Creates `folder/name` if missing and rotates the folder. */
    private fun ensure(
        folder: Path,
        name: String,
        keep: Int,
    ) {
        val target = folder.resolve(name)
        if (!Files.exists(target)) {
            snapshot(target)
            logger.info("Backup created: {}", target)
        }
        rotate(folder, keep)
    }

    /** Transactionally consistent copy via H2's online backup (a zip holding the database files). */
    private fun snapshot(target: Path) {
        Files.createDirectories(target.parent)
        // Write to a temp file first so a failed backup never leaves a partial zip behind.
        val temp = target.resolveSibling("${target.name}.tmp")
        try {
            dataSource.connection.use { connection ->
                connection.createStatement().use { statement ->
                    statement.execute("BACKUP TO '${sqlLiteral(temp)}'")
                }
            }
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE)
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    /** Deletes the backups beyond the [keep] most recent ones in [folder]. */
    private fun rotate(
        folder: Path,
        keep: Int,
    ) {
        if (!Files.isDirectory(folder)) return
        val names =
            Files.newDirectoryStream(folder, "${BackupRetention.PREFIX}*${BackupRetention.SUFFIX}").use { entries ->
                entries.map { it.name }
            }
        BackupRetention.excess(names, keep).forEach { name ->
            Files.deleteIfExists(folder.resolve(name))
            logger.info("Backup rotated (removed): {}", name)
        }
    }

    private fun isFileDatabase(): Boolean = dataSource.connection.use { it.metaData.url?.contains(":mem:") == false }

    /** Escapes the path for use inside a SQL string literal. */
    private fun sqlLiteral(path: Path): String = path.toAbsolutePath().toString().replace("'", "''")
}
