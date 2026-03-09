package com.stocks.service

import com.stocks.dto.DIVIDEND_TYPE_ALIASES
import com.stocks.dto.DividendBatchRequest
import com.stocks.dto.DividendCsvRow
import com.stocks.dto.VALID_CURRENCIES
import com.stocks.model.AssetEntity
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val BR_DATE_FORMAT_DIV = DateTimeFormatter.ofPattern("dd/MM/yyyy")

@Service
class DividendCsvParsingService(
    private val dividendService: DividendService,
) {
    fun parseDividendCsvRows(rawCsv: String): List<DividendCsvRow> {
        val lines = rawCsv.lines().filter { it.isNotBlank() }
        if (lines.isEmpty()) return emptyList()

        val existingTickers = transaction { AssetEntity.all().map { it.ticker.value }.toSet() }

        return lines.mapIndexed { index, line ->
            parseSingleRow(index, line, existingTickers)
        }
    }

    fun batchImportDividends(request: DividendBatchRequest): Int {
        var inserted = 0
        for (row in request.rows) {
            dividendService.createDividend(
                ticker = row.ticker,
                type = row.type,
                date = LocalDate.parse(row.date),
                totalAmount = row.totalAmount,
                taxWithheld = row.taxWithheld,
                notes = row.notes.ifBlank { null },
                broker = row.broker.ifBlank { null },
                currency = row.currency.ifBlank { "BRL" },
            )
            inserted++
        }
        return inserted
    }

    private fun parseSingleRow(
        index: Int,
        line: String,
        existingTickers: Set<String>,
    ): DividendCsvRow {
        val cols = line.split("\t")

        val errorRow = { msg: String ->
            DividendCsvRow(
                rowIndex = index,
                ticker = cols.getOrElse(0) { "" }.trim().uppercase(),
                date = cols.getOrElse(1) { "" }.trim(),
                type = cols.getOrElse(2) { "" }.trim().uppercase(),
                totalAmount = 0.0,
                taxWithheld = 0.0,
                currency = cols.getOrElse(5) { "BRL" }.trim().uppercase(),
                broker = cols.getOrElse(6) { "" }.trim(),
                notes = cols.getOrElse(8) { "" }.trim(),
                error = msg,
            )
        }

        if (cols.size < 7) {
            return errorRow("Colunas insuficientes (esperado pelo menos 7, encontrado ${cols.size})")
        }

        val ticker = cols[0].trim().uppercase()
        if (ticker.isBlank()) return errorRow("Ticker vazio")

        val dateStr = cols[1].trim()
        val isoDate =
            try {
                LocalDate.parse(dateStr, BR_DATE_FORMAT_DIV).format(DateTimeFormatter.ISO_LOCAL_DATE)
            } catch (e: Exception) {
                return errorRow("Data inválida: $dateStr")
            }

        val rawType = cols[2].trim().uppercase()
        val type =
            DIVIDEND_TYPE_ALIASES[rawType]
                ?: return errorRow("Tipo desconhecido: ${cols[2].trim()}")

        val totalAmount = parseBrazilianNumber(cols[3]) ?: return errorRow("Valor inválido: ${cols[3]}")
        if (totalAmount <= 0) return errorRow("Valor deve ser > 0")

        val taxWithheld = parseBrazilianNumber(cols[4]) ?: 0.0
        if (taxWithheld < 0) return errorRow("IR Retido não pode ser negativo")

        val currency =
            cols[5]
                .trim()
                .uppercase()
                .let { if (it in VALID_CURRENCIES) it else "BRL" }

        val broker = cols.getOrElse(6) { "" }.trim()

        // Column 7 ([ignorar]) is skipped
        val notes = cols.getOrElse(8) { "" }.trim()

        if (ticker !in existingTickers) {
            return errorRow("Ativo não cadastrado: $ticker")
        }

        return DividendCsvRow(
            rowIndex = index,
            ticker = ticker,
            date = isoDate,
            type = type,
            totalAmount = totalAmount,
            taxWithheld = taxWithheld,
            currency = currency,
            broker = broker,
            notes = notes,
        )
    }
}
