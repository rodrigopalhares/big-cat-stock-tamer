package com.stocks.config

import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.web.client.RestClient

@Configuration
class HttpClientConfig {
    private val logger = LoggerFactory.getLogger(HttpClientConfig::class.java)

    @Bean
    fun restClient(builder: RestClient.Builder): RestClient =
        builder
            .requestInterceptor(loggingInterceptor())
            .build()

    private fun loggingInterceptor() =
        ClientHttpRequestInterceptor { request, body, execution ->
            val startTime = System.currentTimeMillis()
            val response = execution.execute(request, body)
            val duration = System.currentTimeMillis() - startTime
            logger.info("{} {} {} ({}ms)", request.method, request.uri, response.statusCode.value(), duration)
            response
        }
}
