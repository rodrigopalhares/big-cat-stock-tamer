package com.stocks.config

import com.stocks.service.AuthService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

const val SESSION_COOKIE = "STOCKS_SESSION"

/**
 * Requires a valid session cookie for every request, except the login/logout endpoints
 * and static assets. Unauthenticated requests are redirected to the login page (or answered
 * with an HX-Redirect header for HTMX requests).
 */
@Component
class AuthFilter(
    private val authService: AuthService,
) : OncePerRequestFilter() {
    private val publicPrefixes =
        listOf("/login", "/logout", "/css/", "/js/", "/favicon.ico", "/logo.png")

    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        if (!authService.authEnabled) return true
        val path = request.requestURI
        return publicPrefixes.any { path == it || path.startsWith(it) }
    }

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val token = request.cookies?.firstOrNull { it.name == SESSION_COOKIE }?.value
        if (authService.isValid(token)) {
            filterChain.doFilter(request, response)
            return
        }

        if (request.getHeader("HX-Request") != null) {
            response.setHeader("HX-Redirect", "/login")
            response.status = HttpServletResponse.SC_UNAUTHORIZED
        } else {
            response.sendRedirect("/login")
        }
    }
}
