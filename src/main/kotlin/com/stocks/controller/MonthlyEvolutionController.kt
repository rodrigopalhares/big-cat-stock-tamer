package com.stocks.controller

import com.stocks.service.MonthlyEvolutionService
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.*

@Controller
@RequestMapping("/evolution")
class MonthlyEvolutionController(
    private val monthlyEvolutionService: MonthlyEvolutionService,
) {
    // --- HTML Routes ---

    @GetMapping("/")
    fun evolutionPage(model: Model): String {
        val summary = monthlyEvolutionService.getEvolution()
        model.addAttribute("months", summary.months)
        model.addAttribute("tickers", summary.tickers)
        return "evolution"
    }

    @PostMapping("/recalculate")
    fun recalculate(): String {
        monthlyEvolutionService.recalculate()
        return "redirect:/evolution/"
    }

    // --- JSON API Routes ---

    @GetMapping("/api")
    @ResponseBody
    fun evolutionApi() = monthlyEvolutionService.getEvolution()

    @PostMapping("/api/recalculate")
    @ResponseBody
    fun recalculateApi(): Map<String, String> {
        monthlyEvolutionService.recalculate()
        return mapOf("status" to "ok")
    }
}
