package com.stocks.controller

import com.stocks.dto.ASSET_TYPES
import com.stocks.dto.AssetRequest
import com.stocks.dto.AssetResponse
import com.stocks.dto.DIVIDEND_TYPES
import com.stocks.service.AssetService
import com.stocks.service.DividendService
import com.stocks.service.QuoteService
import com.stocks.service.TransactionService
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

@Controller
@RequestMapping("/assets")
class AssetController(
    private val quoteService: QuoteService,
    private val assetService: AssetService,
    private val transactionService: TransactionService,
    private val dividendService: DividendService,
) {
    // --- HTML Routes ---

    @GetMapping("/ticker-info")
    @ResponseBody
    fun tickerInfo(
        @RequestParam ticker: String
    ): String {
        val normalized = ticker.uppercase().trim()
        if (normalized.length < 3) return ""

        if (assetService.exists(normalized)) {
            return """<div class="alert alert-warning small p-2 mb-0">
                <i class="bi bi-exclamation-circle me-1"></i>
                <strong>$normalized</strong> já cadastrado
                </div>"""
        }

        val info = quoteService.fetchAssetInfo(normalized)
        val found = info.name != normalized

        val preview =
            if (found) {
                """<div class="alert alert-info small p-2 mb-0">
                <i class="bi bi-cloud-download me-1"></i>
                <strong>$normalized</strong> — ${info.name}
                <span class="badge bg-secondary">${info.type}</span>
                </div>"""
            } else {
                """<div class="alert alert-secondary small p-2 mb-0">
                <i class="bi bi-question-circle me-1"></i>
                <strong>$normalized</strong> não encontrado na internet
                </div>"""
            }

        val typeOptions =
            ASSET_TYPES.joinToString("") { t ->
                val selected = if (t == info.type) "selected" else ""
                """<option value="$t" $selected>$t</option>"""
            }
        val currency = info.currency
        val currencyOptions =
            """
            <option value="BRL" ${if (currency == "BRL") "selected" else ""}>BRL — Real</option>
            <option value="USD" ${if (currency == "USD") "selected" else ""}>USD — Dólar</option>
            """.trimIndent()
        val nameVal = if (found) info.name else ""

        val oob =
            """
            <input hx-swap-oob="true" id="assetName" type="text" name="name" class="form-control" placeholder="Ex: Petrobras PN" value="$nameVal">
            <select hx-swap-oob="true" id="assetType" name="type" class="form-select">$typeOptions</select>
            <input hx-swap-oob="true" id="assetYfTicker" type="hidden" name="yf_ticker" value="${info.yfTicker}">
            <select hx-swap-oob="true" id="assetCurrency" name="currency" class="form-select">$currencyOptions</select>
            """.trimIndent()

        return preview + oob
    }

    @GetMapping("/{ticker}")
    fun assetDetail(
        @PathVariable ticker: String,
        model: Model,
    ): String {
        val normalizedTicker = ticker.uppercase()
        val asset =
            assetService.findById(normalizedTicker)
                ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")

        val transactions =
            transaction {
                transactionService.listTransactions(normalizedTicker).map { tx ->
                    TransactionController.TransactionTemplateData(
                        id = tx.id.value,
                        assetTicker = tx.assetId,
                        type = tx.type,
                        quantity = tx.quantity,
                        price = tx.price,
                        fees = tx.fees,
                        date = tx.date,
                        broker = tx.broker,
                        notes = tx.notes,
                        total = if (tx.type == "BUY") tx.quantity * tx.price + tx.fees else tx.quantity * tx.price - tx.fees,
                        currency = tx.asset.currency,
                    )
                }
            }

        val dividends =
            transaction {
                dividendService.listDividends(normalizedTicker).map { d ->
                    DividendController.DividendTemplateData(
                        id = d.id.value,
                        assetTicker = d.assetId,
                        type = d.type,
                        date = d.date,
                        totalAmount = d.totalAmount,
                        taxWithheld = d.taxWithheld,
                        netAmount = d.totalAmount - d.taxWithheld,
                        totalAmountBrl = d.totalAmountBrl,
                        taxWithheldBrl = d.taxWithheldBrl,
                        netAmountBrl = d.totalAmountBrl - d.taxWithheldBrl,
                        broker = d.broker,
                        currency = d.currency,
                        notes = d.notes,
                    )
                }
            }

        model.addAttribute("asset", asset)
        model.addAttribute("transactions", transactions)
        model.addAttribute("dividends", dividends)
        model.addAttribute("assetTypes", ASSET_TYPES)
        model.addAttribute("dividendTypes", DIVIDEND_TYPES)
        return "asset-detail"
    }

    @GetMapping("/")
    fun listAssets(
        @RequestParam(required = false) type: String?,
        @RequestParam(required = false) position: String?,
        @RequestParam(required = false) delisted: String?,
        model: Model,
    ): String {
        model.addAttribute("assets", assetService.findFiltered(type, position, delisted))
        model.addAttribute("assetTypes", ASSET_TYPES)
        model.addAttribute("selectedType", type ?: "")
        model.addAttribute("selectedPosition", position ?: "")
        model.addAttribute("selectedDelisted", delisted ?: "")
        model.addAttribute("tickersWithPosition", transaction { assetService.computeTickersWithPosition() })
        return "assets"
    }

    @PostMapping("/new")
    fun createAssetForm(
        @RequestParam ticker: String,
        @RequestParam(defaultValue = "") name: String,
        @RequestParam(defaultValue = "STOCK") type: String,
        @RequestParam(name = "yf_ticker", defaultValue = "") yfTicker: String,
        @RequestParam(defaultValue = "BRL") currency: String,
        model: Model,
    ): String {
        val normalizedTicker = ticker.uppercase().trim()

        if (assetService.exists(normalizedTicker)) {
            model.addAttribute("assets", assetService.findAll())
            model.addAttribute("assetTypes", ASSET_TYPES)
            model.addAttribute("selectedType", "")
            model.addAttribute("selectedPosition", "")
            model.addAttribute("selectedDelisted", "")
            model.addAttribute("tickersWithPosition", transaction { assetService.computeTickersWithPosition() })
            model.addAttribute("error", "Ativo '$normalizedTicker' já cadastrado.")
            return "assets"
        }

        var resolvedName = name
        var resolvedType = type
        var resolvedYfTicker = yfTicker
        var resolvedCurrency = currency

        if (resolvedName.isBlank()) {
            val info = quoteService.fetchAssetInfo(normalizedTicker)
            resolvedName = if (info.name != normalizedTicker) info.name else ""
            if (resolvedType.isBlank()) resolvedType = info.type
            if (resolvedYfTicker.isBlank()) resolvedYfTicker = info.yfTicker
            if (resolvedCurrency.isBlank()) resolvedCurrency = info.currency
        }

        assetService.create(
            AssetRequest(
                ticker = normalizedTicker,
                yfTicker = resolvedYfTicker.ifBlank { null },
                name = resolvedName.ifBlank { null },
                type = resolvedType.ifBlank { "STOCK" },
                currency = resolvedCurrency.ifBlank { "BRL" }
            )
        )

        return "redirect:/assets/"
    }

    @PostMapping("/{ticker}/edit")
    fun editAsset(
        @PathVariable ticker: String,
        @RequestParam(defaultValue = "") name: String,
        @RequestParam(defaultValue = "STOCK") type: String,
        @RequestParam(name = "yf_ticker", defaultValue = "") yfTicker: String,
        @RequestParam(defaultValue = "BRL") currency: String,
        @RequestParam(defaultValue = "false") delisted: String,
        @RequestParam(name = "returnTo", required = false) returnTo: String?,
    ): String {
        assetService.update(ticker, name, type, yfTicker, currency, delisted = (delisted == "on" || delisted == "true"))
        return "redirect:${returnTo ?: "/assets/"}"
    }

    @PostMapping("/{ticker}/delete")
    fun deleteAsset(
        @PathVariable ticker: String
    ): String {
        assetService.delete(ticker)
        return "redirect:/assets/"
    }

    // --- JSON API Routes ---

    @GetMapping("/api")
    @ResponseBody
    fun listAssetsApi(): List<AssetResponse> = assetService.findAll()

    @PostMapping("/api")
    @ResponseBody
    fun createAssetApi(
        @RequestBody request: AssetRequest
    ): ResponseEntity<AssetResponse> {
        val asset = assetService.create(request)
        return ResponseEntity.status(HttpStatus.CREATED).body(asset)
    }

    @GetMapping("/api/{ticker}")
    @ResponseBody
    fun getAssetApi(
        @PathVariable ticker: String
    ): AssetResponse = assetService.findById(ticker) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Asset not found")
}
