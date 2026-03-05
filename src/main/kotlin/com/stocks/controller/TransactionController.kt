package com.stocks.controller

import com.stocks.dto.BatchRequest
import com.stocks.dto.TransactionRequest
import com.stocks.dto.TransactionResponse
import com.stocks.model.AssetEntity
import com.stocks.model.TransactionEntity
import com.stocks.service.TickerLookupStatus
import com.stocks.service.TransactionService
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.*
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Controller
@RequestMapping("/transactions")
class TransactionController(
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
    fun listTransactions(
        @RequestParam(required = false) ticker: String?,
        model: Model,
    ): String {
        val selectedTicker = ticker?.uppercase()

        val transactions =
            transaction {
                transactionService.listTransactions(selectedTicker).map { it.toTemplateData() }
            }

        val assets =
            transaction {
                AssetEntity.all().sortedBy { it.ticker.value }.map {
                    mapOf("ticker" to it.ticker.value, "name" to (it.name ?: ""))
                }
            }

        model.addAttribute("transactions", transactions)
        model.addAttribute("assets", assets)
        model.addAttribute("selectedTicker", selectedTicker)
        model.addAttribute("today", LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE))
        return "transactions"
    }

    @PostMapping("/new")
    fun createTransactionForm(
        @RequestParam ticker: String,
        @RequestParam type: String,
        @RequestParam quantity: Double,
        @RequestParam(required = false) price: Double?,
        @RequestParam(name = "total_price", required = false) totalPrice: Double?,
        @RequestParam(defaultValue = "0.0") fees: Double,
        @RequestParam date: String,
        @RequestParam(defaultValue = "") broker: String,
        @RequestParam(defaultValue = "") notes: String,
    ): String {
        val resolved = transactionService.resolvePrice(price, totalPrice, fees, quantity)
        val parsedDate = LocalDate.parse(date)

        transactionService.createTransaction(
            ticker = ticker,
            type = type,
            quantity = quantity,
            price = resolved.price,
            fees = resolved.fees,
            date = parsedDate,
            broker = broker,
            notes = notes,
        )

        return "redirect:/transactions/"
    }

    @PostMapping("/{transactionId}/delete")
    fun deleteTransaction(
        @PathVariable transactionId: Int,
    ): String {
        transactionService.deleteTransaction(transactionId)
        return "redirect:/transactions/"
    }

    // --- CSV Batch Import Routes ---

    @PostMapping("/parse-csv")
    fun parseCsv(
        @RequestParam csv: String,
        model: Model,
    ): String {
        val rows = transactionService.parseCsvWithAssetLookup(csv)
        model.addAttribute("rows", rows)
        return "fragments/csv-preview :: csvPreview"
    }

    @PostMapping("/batch")
    @ResponseBody
    fun batchImport(
        @RequestBody request: BatchRequest,
    ): ResponseEntity<Map<String, Int>> {
        val inserted = transactionService.batchImport(request)
        return ResponseEntity.ok(mapOf("inserted" to inserted))
    }

    // --- JSON API Routes ---

    @GetMapping("/api")
    @ResponseBody
    fun listTransactionsApi(
        @RequestParam(required = false) ticker: String?,
    ): List<TransactionResponse> =
        transaction {
            transactionService.listTransactions(ticker).map { it.toResponse() }
        }

    @PostMapping("/api")
    @ResponseBody
    fun createTransactionApi(
        @RequestBody request: TransactionRequest,
    ): ResponseEntity<TransactionResponse> {
        request.validate()

        val tx =
            transactionService.createTransactionForExistingAsset(
                assetId = request.assetId,
                type = request.type,
                quantity = request.quantity,
                price = request.price,
                fees = request.fees,
                date = request.date,
                broker = request.broker,
                notes = request.notes,
            )

        return ResponseEntity.status(HttpStatus.CREATED).body(
            transaction { tx.toResponse() },
        )
    }

    @DeleteMapping("/api/{transactionId}")
    @ResponseBody
    fun deleteTransactionApi(
        @PathVariable transactionId: Int,
    ): ResponseEntity<Unit> {
        transactionService.deleteTransaction(transactionId)
        return ResponseEntity.noContent().build()
    }

    private fun TransactionEntity.toResponse() =
        TransactionResponse(
            id = id.value,
            assetId = assetId,
            type = type,
            quantity = quantity,
            price = price,
            fees = fees,
            date = date,
            broker = broker,
            notes = notes,
            createdAt = createdAt,
        )

    // Template data class for Thymeleaf
    data class TransactionTemplateData(
        val id: Int,
        val assetTicker: String,
        val type: String,
        val quantity: Double,
        val price: Double,
        val fees: Double,
        val date: LocalDate,
        val broker: String?,
        val notes: String?,
        val total: Double,
    )

    private fun TransactionEntity.toTemplateData() =
        TransactionTemplateData(
            id = id.value,
            assetTicker = assetId,
            type = type,
            quantity = quantity,
            price = price,
            fees = fees,
            date = date,
            broker = broker,
            notes = notes,
            total = if (type == "BUY") quantity * price + fees else quantity * price - fees,
        )
}
