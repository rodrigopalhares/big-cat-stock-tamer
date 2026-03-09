package com.stocks.config

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.bind.annotation.ModelAttribute
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.servlet.LocaleResolver
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import org.springframework.web.servlet.i18n.FixedLocaleResolver
import java.util.Locale

@Configuration
class WebConfig : WebMvcConfigurer {
    override fun addViewControllers(registry: ViewControllerRegistry) {
        registry.addRedirectViewController("/", "/portfolio/")
    }

    @Bean
    fun localeResolver(): LocaleResolver = FixedLocaleResolver(Locale("pt", "BR"))

    @Bean
    fun requestLoggingFilter() =
        object : OncePerRequestFilter() {
            private val log = LoggerFactory.getLogger("RequestLog")

            override fun doFilterInternal(
                request: HttpServletRequest,
                response: HttpServletResponse,
                filterChain: FilterChain,
            ) {
                val start = System.currentTimeMillis()
                filterChain.doFilter(request, response)
                val duration = System.currentTimeMillis() - start
                log.info("{} {} {} ({}ms)", request.method, request.requestURI, response.status, duration)
            }
        }
}

@ControllerAdvice
class GlobalModelAttributes {
    @ModelAttribute("requestURI")
    fun requestURI(request: HttpServletRequest): String = request.requestURI
}
