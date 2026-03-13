package com.stocks.controller

import com.stocks.service.RiskMetricsService
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseBody
import java.time.format.DateTimeFormatter

@Controller
@RequestMapping("/risk-metrics")
class RiskMetricsController(
    private val riskMetricsService: RiskMetricsService,
) {
    private val dateFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy")

    @GetMapping("/")
    fun riskMetrics(model: Model): String {
        val summary = riskMetricsService.getSummary()

        model.addAttribute("metrics", summary.metrics)
        model.addAttribute("portfolioBeta", summary.portfolioBeta)
        model.addAttribute("cdiAnnual", summary.cdiAnnual)
        model.addAttribute("calculatedAt", summary.calculatedAt?.format(dateFormatter))
        model.addAttribute("hasData", summary.metrics.isNotEmpty())

        return "risk-metrics"
    }

    @PostMapping("/recalculate")
    @ResponseBody
    fun recalculate(): String {
        riskMetricsService.recalculate()
        return ""
    }
}
