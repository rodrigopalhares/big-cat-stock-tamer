package com.stocks.controller

import com.stocks.dto.AssetStatus
import com.stocks.dto.BatchRequest
import com.stocks.dto.TransactionRequest
import com.stocks.dto.TransactionResponse
import com.stocks.dto.parseCsvRows
import com.stocks.model.AssetEntity
import com.stocks.model.TransactionEntity
import com.stocks.service.QuoteService
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Controller
@RequestMapping("/transactions")
class TransactionController(
    private val quoteService: QuoteService,
) {
    // --- HTML Routes ---

    @GetMapping("/ticker-info")
    @ResponseBody
    fun tickerInfo(
        @RequestParam ticker: String
    ): String {
        val normalized = ticker.uppercase().trim()
        if (normalized.length < 3) return ""

        val existing = transaction { AssetEntity.findById(normalized) }
        if (existing != null) {
            val name = transaction { existing.name }
            val type = transaction { existing.type ?: "STOCK" }
            return """<div class="alert alert-success small p-2 mb-0">
                <i class="bi bi-check-circle-fill me-1"></i>
                <strong>$normalized</strong>${if (name != null) " — $name" else ""}
                <span class="badge bg-secondary">$type</span>
                <span class="text-muted ms-2">já cadastrado</span>
                </div>"""
        }

        val info = quoteService.fetchAssetInfo(normalized)
        val found = info.name != normalized
        return if (found) {
            """<div class="alert alert-info small p-2 mb-0">
                <i class="bi bi-cloud-download me-1"></i>
                <strong>$normalized</strong> — ${info.name}
                <span class="badge bg-secondary">${info.type}</span>
                <span class="text-muted ms-2">será cadastrado automaticamente</span>
                </div>"""
        } else {
            """<div class="alert alert-warning small p-2 mb-0">
                <i class="bi bi-question-circle me-1"></i>
                <strong>$normalized</strong>
                <span class="text-muted ms-2">não encontrado na internet — será criado mesmo assim</span>
                </div>"""
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
                var query =
                    TransactionEntity
                        .all()
                        .sortedWith(compareByDescending<TransactionEntity> { it.date }.thenByDescending { it.id.value })

                if (selectedTicker != null) {
                    query = query.filter { it.assetId == selectedTicker }
                }

                query.map { it.toTemplateData() }
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
        val normalizedTicker = ticker.uppercase().trim()
        var resolvedPrice = price
        var resolvedFees = fees

        // Resolve price/fees from total_price when provided
        if (totalPrice != null && totalPrice > 0) {
            if (resolvedPrice != null && resolvedPrice > 0) {
                resolvedFees = totalPrice - quantity * resolvedPrice
            } else {
                resolvedPrice = (totalPrice - resolvedFees) / quantity
            }
        }

        if (resolvedPrice == null || resolvedPrice <= 0) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o preço unitário ou o valor total")
        }

        val parsedDate = LocalDate.parse(date)

        transaction {
            var asset = AssetEntity.findById(normalizedTicker)
            if (asset == null) {
                val info = quoteService.fetchAssetInfo(normalizedTicker)
                asset =
                    AssetEntity.new(normalizedTicker) {
                        yfTicker = info.yfTicker
                        name = if (info.name != normalizedTicker) info.name else null
                        this.type = info.type
                        currency = info.currency
                    }
            }

            TransactionEntity.new {
                assetId = normalizedTicker
                this.type = type.uppercase()
                this.quantity = quantity
                this.price = resolvedPrice
                this.fees = resolvedFees
                this.date = parsedDate
                this.broker = broker.ifBlank { null }
                this.notes = notes.ifBlank { null }
            }
        }

        return "redirect:/transactions/"
    }

    @PostMapping("/{transactionId}/delete")
    fun deleteTransaction(
        @PathVariable transactionId: Int
    ): String {
        transaction {
            val tx =
                TransactionEntity.findById(transactionId)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Transaction not found")
            tx.delete()
        }
        return "redirect:/transactions/"
    }

    // --- CSV Batch Import Routes ---

    @PostMapping("/parse-csv")
    fun parseCsv(
        @RequestParam csv: String,
        model: Model,
    ): String {
        val existingTickers = transaction { AssetEntity.all().map { it.ticker.value }.toSet() }

        val rows =
            parseCsvRows(csv, existingTickers) { ticker ->
                val info = quoteService.fetchAssetInfo(ticker)
                if (info.name != ticker) AssetStatus.WILL_CREATE else AssetStatus.UNKNOWN
            }

        model.addAttribute("rows", rows)
        return "fragments/csv-preview :: csvPreview"
    }

    @PostMapping("/batch")
    @ResponseBody
    fun batchImport(
        @RequestBody request: BatchRequest,
    ): ResponseEntity<Map<String, Int>> {
        var inserted = 0
        transaction {
            for (row in request.rows) {
                val normalizedTicker = row.ticker.uppercase().trim()

                // Look up or auto-create asset
                var asset = AssetEntity.findById(normalizedTicker)
                if (asset == null) {
                    val info = quoteService.fetchAssetInfo(normalizedTicker)
                    asset =
                        AssetEntity.new(normalizedTicker) {
                            yfTicker = info.yfTicker
                            name = if (info.name != normalizedTicker) info.name else null
                            this.type = info.type
                            currency = info.currency
                        }
                }

                TransactionEntity.new {
                    assetId = normalizedTicker
                    type = row.type.uppercase()
                    quantity = row.quantity
                    price = row.price
                    fees = row.fees
                    date = LocalDate.parse(row.date)
                    broker = row.broker.ifBlank { null }
                    notes = row.notes.ifBlank { null }
                }
                inserted++
            }
        }
        return ResponseEntity.ok(mapOf("inserted" to inserted))
    }

    // --- JSON API Routes ---

    @GetMapping("/api")
    @ResponseBody
    fun listTransactionsApi(
        @RequestParam(required = false) ticker: String?
    ): List<TransactionResponse> =
        transaction {
            var query =
                TransactionEntity
                    .all()
                    .sortedByDescending { it.date }
            if (ticker != null) {
                query = query.filter { it.assetId == ticker.uppercase() }
            }
            query.map { it.toResponse() }
        }

    @PostMapping("/api")
    @ResponseBody
    fun createTransactionApi(
        @RequestBody request: TransactionRequest
    ): ResponseEntity<TransactionResponse> {
        request.validate()

        val tx =
            transaction {
                val asset =
                    AssetEntity.findById(request.assetId.uppercase())
                        ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")

                TransactionEntity.new {
                    assetId = asset.ticker.value
                    type = request.type.uppercase().trim()
                    quantity = request.quantity
                    price = request.price
                    fees = request.fees
                    date = request.date
                    broker = request.broker
                    notes = request.notes
                }
            }

        return ResponseEntity.status(HttpStatus.CREATED).body(
            transaction { tx.toResponse() }
        )
    }

    @DeleteMapping("/api/{transactionId}")
    @ResponseBody
    fun deleteTransactionApi(
        @PathVariable transactionId: Int
    ): ResponseEntity<Unit> {
        transaction {
            val tx =
                TransactionEntity.findById(transactionId)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Transaction not found")
            tx.delete()
        }
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
