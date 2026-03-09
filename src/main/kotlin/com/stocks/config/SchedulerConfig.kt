package com.stocks.config

import com.stocks.service.ExchangeRateService
import com.stocks.service.PriceHistoryService
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class SchedulerConfig(
    private val priceHistoryService: PriceHistoryService,
    private val exchangeRateService: ExchangeRateService,
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
}
