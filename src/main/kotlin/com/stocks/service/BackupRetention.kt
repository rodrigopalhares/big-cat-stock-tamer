package com.stocks.service

import java.time.LocalDate

/**
 * Backup retention policy — pure functions, no I/O.
 *
 * Decides the *name* of a period's snapshot and *which* files fall outside the window we want to
 * keep. The stamp in the name (yyyy-MM-dd for daily, yyyy-MM for monthly) sorts lexicographically
 * = chronologically, so a plain `sorted()` is enough to know which ones are the most recent.
 * The I/O (copying/deleting) lives in [BackupService].
 */
object BackupRetention {
    const val PREFIX = "stocks-"
    const val SUFFIX = ".zip"

    /** Name of the day's backup: `stocks-yyyy-MM-dd.zip`. */
    fun dailyName(date: LocalDate): String = "$PREFIX$date$SUFFIX"

    /** Name of the month's backup: `stocks-yyyy-MM.zip`. */
    fun monthlyName(date: LocalDate): String = PREFIX + "%04d-%02d".format(date.year, date.monthValue) + SUFFIX

    /** Names to remove: everything beyond the [keep] most recent ones (`keep <= 0` → all of them). */
    fun excess(
        names: List<String>,
        keep: Int,
    ): List<String> {
        val sorted = names.sorted()
        if (keep <= 0) return sorted
        return sorted.take(maxOf(0, sorted.size - keep))
    }
}
