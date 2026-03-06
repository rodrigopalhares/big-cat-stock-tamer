package com.stocks.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

@Configuration
class HttpClientConfig {
    @Bean
    fun restClient(builder: RestClient.Builder): RestClient = builder.build()
}
