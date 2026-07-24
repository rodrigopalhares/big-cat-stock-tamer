package com.stocks.config

import com.stocks.service.BackupService
import com.stocks.service.ExchangeRateService
import com.stocks.service.PriceHistoryService
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class SchedulerConfig(
    private val priceHistoryService: PriceHistoryService,
    private val exchangeRateService: ExchangeRateService,
    private val backupService: BackupService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @Scheduled(cron = "0 30 18 * * *", zone = "America/Sao_Paulo")
    fun dailyUpdate() {
        logger.info("Running daily price update...")
        try {
            priceHistoryService.runDailyUpdate()
        } catch (e: Exception) {
            logger.error("Error during daily update: ${e.message}", e)
        }

        logger.info("Running daily exchange rate update...")
        try {
            exchangeRateService.getRate("USD")
        } catch (e: Exception) {
            logger.error("Error during exchange rate update: ${e.message}", e)
        }
    }

    /** Backs up on startup so a restart always leaves a recent snapshot behind. */
    @EventListener(ApplicationReadyEvent::class)
    fun backupOnStartup() {
        runBackup()
    }

    /** Runs right after midnight, giving some slack for the day to turn in the configured zone. */
    @Scheduled(cron = "0 5 0 * * *", zone = "America/Sao_Paulo")
    fun dailyBackup() {
        runBackup()
    }

    private fun runBackup() {
        logger.info("Running database backup...")
        try {
            backupService.ensureBackups()
        } catch (e: Exception) {
            logger.error("Error during database backup: ${e.message}", e)
        }
    }
}
