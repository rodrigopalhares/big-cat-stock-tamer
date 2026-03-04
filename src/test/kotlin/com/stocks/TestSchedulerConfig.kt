package com.stocks

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.context.annotation.Profile
import org.springframework.scheduling.TaskScheduler
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler

@TestConfiguration
@Profile("test")
class TestSchedulerConfig {

    @Bean
    @Primary
    fun taskScheduler(): TaskScheduler {
        // No-op scheduler that prevents background jobs from running during tests
        return ThreadPoolTaskScheduler().apply {
            poolSize = 1
            initialize()
        }
    }
}
