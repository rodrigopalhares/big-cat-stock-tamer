package com.stocks.controller

import com.stocks.dto.DIVIDEND_TYPES
import com.stocks.dto.DividendBatchRequest
import com.stocks.dto.DividendRequest
import com.stocks.dto.DividendResponse
import com.stocks.dto.VALID_CURRENCIES
import com.stocks.model.AssetEntity
import com.stocks.model.DividendEntity
import com.stocks.service.DividendCsvParsingService
import com.stocks.service.DividendService
import com.stocks.service.TickerLookupStatus
import com.stocks.service.TransactionService
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.*
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Controller
@RequestMapping("/dividends")
class DividendController(
    private val dividendService: DividendService,
    private val dividendCsvParsingService: DividendCsvParsingService,
    private val transactionService: TransactionService,
) {
    // --- HTML Routes ---

    @GetMapping("/ticker-info")
    @ResponseBody
    fun tickerInfo(
        @RequestParam ticker: String,
    ): String {
        val result = transactionService.lookupTickerInfo(ticker)
        if (result.ticker.length < 3) return ""

        return when (result.status) {
            TickerLookupStatus.EXISTS -> {
                """<div class="alert alert-success small p-2 mb-0">
                <i class="bi bi-check-circle-fill me-1"></i>
                <strong>${result.ticker}</strong>${if (result.name != null) " — ${result.name}" else ""}
                <span class="badge bg-secondary">${result.type}</span>
                <span class="text-muted ms-2">já cadastrado</span>
                </div>"""
            }
            TickerLookupStatus.FOUND_ONLINE -> {
                """<div class="alert alert-info small p-2 mb-0">
                <i class="bi bi-cloud-download me-1"></i>
                <strong>${result.ticker}</strong> — ${result.name}
                <span class="badge bg-secondary">${result.type}</span>
                <span class="text-muted ms-2">será cadastrado automaticamente</span>
                </div>"""
            }
            TickerLookupStatus.NOT_FOUND -> {
                """<div class="alert alert-warning small p-2 mb-0">
                <i class="bi bi-question-circle me-1"></i>
                <strong>${result.ticker}</strong>
                <span class="text-muted ms-2">não encontrado na internet — será criado mesmo assim</span>
                </div>"""
            }
        }
    }

    @GetMapping("/")
    fun listDividends(
        @RequestParam(required = false) ticker: String?,
        @RequestParam(required = false) type: String?,
        model: Model,
    ): String {
        val selectedTicker = ticker?.uppercase()

        val dividends =
            transaction {
                dividendService.listDividends(selectedTicker, type).map { it.toTemplateData() }
            }

        val assets =
            transaction {
                AssetEntity.all().sortedBy { it.ticker.value }.map {
                    mapOf("ticker" to it.ticker.value, "name" to (it.name ?: ""))
                }
            }

        model.addAttribute("dividends", dividends)
        model.addAttribute("assets", assets)
        model.addAttribute("dividendTypes", DIVIDEND_TYPES)
        model.addAttribute("selectedTicker", selectedTicker)
        model.addAttribute("selectedType", type ?: "")
        model.addAttribute("today", LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE))
        return "dividends"
    }

    @PostMapping("/new")
    fun createDividendForm(
        @RequestParam ticker: String,
        @RequestParam type: String,
        @RequestParam(name = "total_amount") totalAmount: Double,
        @RequestParam(name = "tax_withheld", defaultValue = "0.0") taxWithheld: Double,
        @RequestParam date: String,
        @RequestParam(defaultValue = "BRL") currency: String,
        @RequestParam(defaultValue = "") notes: String,
    ): String {
        val parsedDate = LocalDate.parse(date)

        dividendService.createDividend(
            ticker = ticker,
            type = type,
            date = parsedDate,
            totalAmount = totalAmount,
            taxWithheld = taxWithheld,
            notes = notes,
            currency = currency,
        )

        return "redirect:/dividends/"
    }

    @PostMapping("/{dividendId}/edit")
    fun editDividend(
        @PathVariable dividendId: Int,
        @RequestParam type: String,
        @RequestParam(name = "total_amount") totalAmount: Double,
        @RequestParam(name = "tax_withheld", defaultValue = "0.0") taxWithheld: Double,
        @RequestParam date: String,
        @RequestParam(defaultValue = "BRL") currency: String,
        @RequestParam(defaultValue = "") notes: String,
        @RequestParam(name = "returnTo", required = false) returnTo: String?,
    ): String {
        dividendService.updateDividend(
            id = dividendId,
            type = type,
            date = LocalDate.parse(date),
            totalAmount = totalAmount,
            taxWithheld = taxWithheld,
            notes = notes,
            currency = currency,
        )
        return "redirect:${returnTo ?: "/dividends/"}"
    }

    @PostMapping("/{dividendId}/delete")
    fun deleteDividend(
        @PathVariable dividendId: Int,
        @RequestParam(name = "returnTo", required = false) returnTo: String?,
    ): String {
        dividendService.deleteDividend(dividendId)
        return "redirect:${returnTo ?: "/dividends/"}"
    }

    // --- CSV Import Routes ---

    @PostMapping("/parse-csv")
    fun parseDividendCsv(
        @RequestParam csv: String,
        model: Model,
    ): String {
        val rows = dividendCsvParsingService.parseDividendCsvRows(csv)
        model.addAttribute("rows", rows)
        model.addAttribute("dividendTypes", DIVIDEND_TYPES)
        model.addAttribute("currencies", VALID_CURRENCIES)
        return "fragments/dividend-csv-preview :: dividendCsvPreview"
    }

    @PostMapping("/batch")
    @ResponseBody
    fun batchImportDividends(
        @RequestBody request: DividendBatchRequest,
    ): ResponseEntity<Map<String, Int>> {
        val inserted = dividendCsvParsingService.batchImportDividends(request)
        return ResponseEntity.ok(mapOf("imported" to inserted))
    }

    // --- JSON API Routes ---

    @GetMapping("/api")
    @ResponseBody
    fun listDividendsApi(
        @RequestParam(required = false) ticker: String?,
        @RequestParam(required = false) type: String?,
    ): List<DividendResponse> =
        transaction {
            dividendService.listDividends(ticker, type).map { it.toResponse() }
        }

    @PostMapping("/api")
    @ResponseBody
    fun createDividendApi(
        @RequestBody request: DividendRequest,
    ): ResponseEntity<DividendResponse> {
        request.validate()

        val dividend =
            dividendService.createDividend(
                ticker = request.assetId,
                type = request.type,
                date = request.date,
                totalAmount = request.totalAmount,
                taxWithheld = request.taxWithheld,
                notes = request.notes,
                broker = request.broker,
                currency = request.currency ?: "BRL",
            )

        return ResponseEntity.status(HttpStatus.CREATED).body(
            transaction { dividend.toResponse() },
        )
    }

    @DeleteMapping("/api/{dividendId}")
    @ResponseBody
    fun deleteDividendApi(
        @PathVariable dividendId: Int,
    ): ResponseEntity<Unit> {
        dividendService.deleteDividend(dividendId)
        return ResponseEntity.noContent().build()
    }

    private fun DividendEntity.toResponse() =
        DividendResponse(
            id = id.value,
            assetId = assetId,
            type = type,
            date = date,
            totalAmount = totalAmount,
            taxWithheld = taxWithheld,
            netAmount = totalAmount - taxWithheld,
            totalAmountBrl = totalAmountBrl,
            taxWithheldBrl = taxWithheldBrl,
            netAmountBrl = totalAmountBrl - taxWithheldBrl,
            broker = broker,
            currency = currency,
            notes = notes,
            createdAt = createdAt,
        )

    data class DividendTemplateData(
        val id: Int,
        val assetTicker: String,
        val type: String,
        val date: LocalDate,
        val totalAmount: Double,
        val taxWithheld: Double,
        val netAmount: Double,
        val totalAmountBrl: Double,
        val taxWithheldBrl: Double,
        val netAmountBrl: Double,
        val broker: String?,
        val currency: String,
        val notes: String?,
    )

    private fun DividendEntity.toTemplateData() =
        DividendTemplateData(
            id = id.value,
            assetTicker = assetId,
            type = type,
            date = date,
            totalAmount = totalAmount,
            taxWithheld = taxWithheld,
            netAmount = totalAmount - taxWithheld,
            totalAmountBrl = totalAmountBrl,
            taxWithheldBrl = taxWithheldBrl,
            netAmountBrl = totalAmountBrl - taxWithheldBrl,
            broker = broker,
            currency = currency,
            notes = notes,
        )
}
