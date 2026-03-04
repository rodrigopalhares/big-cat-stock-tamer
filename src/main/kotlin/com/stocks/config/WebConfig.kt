package com.stocks.config

import jakarta.servlet.http.HttpServletRequest
import org.springframework.context.annotation.Configuration
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.bind.annotation.ModelAttribute
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

@Configuration
class WebConfig : WebMvcConfigurer {

    override fun addViewControllers(registry: ViewControllerRegistry) {
        registry.addRedirectViewController("/", "/portfolio/")
    }
}

@ControllerAdvice
class GlobalModelAttributes {

    @ModelAttribute("requestURI")
    fun requestURI(request: HttpServletRequest): String = request.requestURI
}
