package com.stocks.config

import com.stocks.service.PriceHistoryService
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class SchedulerConfig(
    private val priceHistoryService: PriceHistoryService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @EventListener(ApplicationReadyEvent::class)
    fun onStartup() {
        logger.info("Running initial price backfill...")
        try {
            priceHistoryService.runBackfill()
        } catch (e: Exception) {
            logger.error("Error during startup backfill: ${e.message}", e)
        }
    }

    @Scheduled(cron = "0 30 18 * * *", zone = "America/Sao_Paulo")
    fun dailyUpdate() {
        logger.info("Running daily price update...")
        try {
            priceHistoryService.runDailyUpdate()
        } catch (e: Exception) {
            logger.error("Error during daily update: ${e.message}", e)
        }
    }
}
