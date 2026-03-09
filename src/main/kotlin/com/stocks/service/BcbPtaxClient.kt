package com.stocks.service

import com.stocks.dto.BcbPtaxResponse
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import org.springframework.web.client.body
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Service
class BcbPtaxClient(
    private val restClient: RestClient,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    private val bcbDateFormatter = DateTimeFormatter.ofPattern("MM-dd-yyyy")

    fun fetchRange(
        startDate: LocalDate,
        endDate: LocalDate,
    ): List<Pair<LocalDate, Pair<Double, Double>>> {
        val start = bcbDateFormatter.format(startDate)
        val end = bcbDateFormatter.format(endDate)
        val url =
            "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
                "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
                "?@dataInicial='$start'&@dataFinalCotacao='$end'&\$format=json"

        logger.info("Fetching BCB PTAX: $url")

        return try {
            val response =
                restClient
                    .get()
                    .uri(url)
                    .retrieve()
                    .body<BcbPtaxResponse>() ?: return emptyList()

            response.value.mapNotNull { quote ->
                try {
                    val dateStr = quote.dataHoraCotacao.substringBefore(" ")
                    val quoteDate = LocalDate.parse(dateStr, DateTimeFormatter.ofPattern("yyyy-MM-dd"))
                    quoteDate to (quote.cotacaoCompra to quote.cotacaoVenda)
                } catch (e: Exception) {
                    logger.warn("Error parsing BCB quote date: ${quote.dataHoraCotacao}: ${e.message}")
                    null
                }
            }
        } catch (e: Exception) {
            logger.error("Error fetching BCB PTAX rates: ${e.message}")
            emptyList()
        }
    }
}
