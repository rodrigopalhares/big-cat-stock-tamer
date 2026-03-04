package com.stocks.config

import org.jetbrains.exposed.sql.Database
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import javax.sql.DataSource

@Configuration
class DatabaseConfig {

    @Bean
    fun database(dataSource: DataSource): Database {
        return Database.connect(dataSource)
    }
}
