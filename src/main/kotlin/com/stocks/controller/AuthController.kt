package com.stocks.controller

import com.stocks.config.SESSION_COOKIE
import com.stocks.service.AuthService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.ResponseCookie
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam

@Controller
class AuthController(
    private val authService: AuthService,
    @Value("\${app.auth.session-days:365}") private val sessionDays: Long,
) {
    @GetMapping("/login")
    fun loginPage(model: Model): String {
        if (!authService.authEnabled) return "redirect:/portfolio/"
        return "login"
    }

    @PostMapping("/login")
    fun login(
        @RequestParam password: String,
        response: HttpServletResponse,
        model: Model,
    ): String {
        val token = authService.login(password)
        if (token == null) {
            model.addAttribute("error", true)
            return "login"
        }
        response.addHeader("Set-Cookie", sessionCookie(token, sessionDays * 86_400).toString())
        return "redirect:/portfolio/"
    }

    @PostMapping("/logout")
    fun logout(
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): String {
        val token = request.cookies?.firstOrNull { it.name == SESSION_COOKIE }?.value
        authService.logout(token)
        response.addHeader("Set-Cookie", sessionCookie("", 0).toString())
        return "redirect:/login"
    }

    private fun sessionCookie(
        value: String,
        maxAgeSeconds: Long,
    ): ResponseCookie =
        ResponseCookie
            .from(SESSION_COOKIE, value)
            .httpOnly(true)
            .path("/")
            .sameSite("Lax")
            .maxAge(maxAgeSeconds)
            .build()
}
