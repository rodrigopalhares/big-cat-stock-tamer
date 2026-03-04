package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.maps.shouldContainKey
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.ktor.client.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import java.time.LocalDate

private fun loadFixture(name: String): String = QuoteServiceTest::class.java.getResource("/fixtures/$name")!!.readText()

private fun buildMockClient(fixtureMap: Map<String, String>): HttpClient =
    HttpClient(
        MockEngine { request ->
            val url = request.url.toString()
            val fixture = fixtureMap.entries.firstOrNull { (key, _) -> key in url }
            if (fixture != null) {
                respond(
                    content = fixture.value,
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json")
                )
            } else {
                respond(
                    content = loadFixture("yahoo_chart_empty.json"),
                    status = HttpStatusCode.NotFound,
                    headers = headersOf(HttpHeaders.ContentType, "application/json")
                )
            }
        }
    )

class QuoteServiceTest :
    FunSpec({

        // ==================== fetchQuotesBatch ====================

        test("fetchQuotesBatch - empty tickers returns empty map") {
            val service = QuoteService(buildMockClient(emptyMap()))
            service.fetchQuotesBatch(emptyList()) shouldBe emptyMap()
        }

        test("fetchQuotesBatch - single ticker returns price from regularMarketPrice") {
            val client =
                buildMockClient(
                    mapOf(
                        "PETR3.SA" to loadFixture("yahoo_chart_petr3.json")
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchQuotesBatch(listOf("PETR3.SA"))
            result shouldContainKey "PETR3.SA"
            result["PETR3.SA"]!! shouldBe (38.45 plusOrMinus 0.01)
        }

        test("fetchQuotesBatch - multiple tickers returns all prices") {
            val client =
                buildMockClient(
                    mapOf(
                        "PETR3.SA" to loadFixture("yahoo_chart_petr3.json"),
                        "BOVA11.SA" to loadFixture("yahoo_chart_etf.json")
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchQuotesBatch(listOf("PETR3.SA", "BOVA11.SA"))
            result shouldContainKey "PETR3.SA"
            result shouldContainKey "BOVA11.SA"
            result["PETR3.SA"]!! shouldBe (38.45 plusOrMinus 0.01)
            result["BOVA11.SA"]!! shouldBe (128.50 plusOrMinus 0.01)
        }

        test("fetchQuotesBatch - ticker with zero price is excluded") {
            val client =
                buildMockClient(
                    mapOf(
                        "ZERO3.SA" to loadFixture("yahoo_chart_zero_price.json")
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchQuotesBatch(listOf("ZERO3.SA"))
            result.shouldBeEmpty()
        }

        test("fetchQuotesBatch - API error returns empty map (graceful degradation)") {
            val client =
                buildMockClient(
                    mapOf(
                        "INVALID" to loadFixture("yahoo_chart_empty.json")
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchQuotesBatch(listOf("INVALID"))
            result.shouldBeEmpty()
        }

        // ==================== fetchAssetInfo ====================

        test("fetchAssetInfo - PETR3 returns name, type=STOCK, yfTicker=PETR3.SA, currency=BRL") {
            val client =
                buildMockClient(
                    mapOf(
                        "PETR3.SA" to loadFixture("yahoo_chart_petr3.json")
                    )
                )
            val service = QuoteService(client)
            val info = service.fetchAssetInfo("PETR3")
            info.name shouldContain "Petrobras"
            info.type shouldBe "STOCK"
            info.yfTicker shouldBe "PETR3.SA"
            info.currency shouldBe "BRL"
        }

        test("fetchAssetInfo - ETF instrumentType returns type=ETF") {
            val client =
                buildMockClient(
                    mapOf(
                        "BOVA11.SA" to loadFixture("yahoo_chart_etf.json")
                    )
                )
            val service = QuoteService(client)
            val info = service.fetchAssetInfo("BOVA11")
            info.type shouldBe "ETF"
            info.yfTicker shouldBe "BOVA11.SA"
        }

        test("fetchAssetInfo - unknown ticker returns fallback AssetInfo") {
            val client = buildMockClient(emptyMap())
            val service = QuoteService(client)
            val info = service.fetchAssetInfo("XYZW99")
            info.name shouldBe "XYZW99"
            info.type shouldBe "STOCK"
            info.yfTicker shouldBe "XYZW99.SA"
            info.currency shouldBe "BRL"
        }

        test("fetchAssetInfo - USD currency is preserved") {
            val client =
                buildMockClient(
                    mapOf(
                        "AAPL" to loadFixture("yahoo_chart_usd_asset.json")
                    )
                )
            val service = QuoteService(client)
            // ticker with dot -> only tries "AAPL" directly
            val info = service.fetchAssetInfo("AAPL")
            // Since "AAPL" has no dot, it tries AAPL.SA first (miss), then AAPL (hit)
            info.currency shouldBe "USD"
            info.name shouldBe "Apple Inc."
        }

        test("fetchAssetInfo - non-BRL/USD currency defaults to BRL") {
            val client =
                buildMockClient(
                    mapOf(
                        "SAP.DE" to loadFixture("yahoo_chart_eur_asset.json")
                    )
                )
            val service = QuoteService(client)
            val info = service.fetchAssetInfo("SAP.DE")
            info.currency shouldBe "BRL"
        }

        // ==================== fetchExchangeRate ====================

        test("fetchExchangeRate - same currency returns 1.0") {
            val service = QuoteService(buildMockClient(emptyMap()))
            service.fetchExchangeRate("BRL", "BRL") shouldBe 1.0
        }

        test("fetchExchangeRate - different currency fetches rate from API") {
            val client =
                buildMockClient(
                    mapOf(
                        "USDBRL=X" to loadFixture("yahoo_chart_usdbrl.json")
                    )
                )
            val service = QuoteService(client)
            val rate = service.fetchExchangeRate("USD", "BRL")
            rate shouldBe (5.85 plusOrMinus 0.01)
        }

        test("fetchExchangeRate - cached rate is reused within 5 minutes") {
            var callCount = 0
            val mockEngine =
                MockEngine { request ->
                    callCount++
                    respond(
                        content = loadFixture("yahoo_chart_usdbrl.json"),
                        status = HttpStatusCode.OK,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
            val service = QuoteService(HttpClient(mockEngine))

            val rate1 = service.fetchExchangeRate("USD", "BRL")
            val rate2 = service.fetchExchangeRate("USD", "BRL")
            rate1 shouldBe (5.85 plusOrMinus 0.01)
            rate2 shouldBe (5.85 plusOrMinus 0.01)
            callCount shouldBe 1 // second call uses cache
        }

        test("fetchExchangeRate - returns fallback 6.0 when API fails") {
            val client = buildMockClient(emptyMap()) // all requests return error
            val service = QuoteService(client)
            val rate = service.fetchExchangeRate("USD", "BRL")
            rate shouldBe 6.0
        }

        // ==================== fetchHistoricalQuotesBatch ====================

        test("fetchHistoricalQuotesBatch - empty map returns empty map") {
            val service = QuoteService(buildMockClient(emptyMap()))
            service.fetchHistoricalQuotesBatch(emptyMap(), LocalDate.now()) shouldBe emptyMap()
        }

        test("fetchHistoricalQuotesBatch - returns sorted list of date-close pairs, skipping nulls and negatives") {
            val client =
                buildMockClient(
                    mapOf(
                        "PETR3.SA" to loadFixture("yahoo_chart_historical.json")
                    )
                )
            val service = QuoteService(client)
            val result =
                service.fetchHistoricalQuotesBatch(
                    mapOf("PETR3.SA" to "PETR3"),
                    LocalDate.of(2024, 3, 1)
                )
            result shouldContainKey "PETR3"
            val prices = result["PETR3"]!!
            // The fixture has 5 timestamps: [37.80, null, 38.40, -1.0, 38.45]
            // Only 37.80, 38.40, 38.45 should be included (null and -1.0 skipped)
            prices shouldHaveSize 3
            prices[0].second shouldBe (37.80 plusOrMinus 0.01)
            prices[1].second shouldBe (38.40 plusOrMinus 0.01)
            prices[2].second shouldBe (38.45 plusOrMinus 0.01)
            // verify sorted by date
            prices.zipWithNext().forEach { (a, b) -> (a.first <= b.first) shouldBe true }
        }

        test("fetchHistoricalQuotesBatch - API error returns empty map") {
            val client = buildMockClient(emptyMap())
            val service = QuoteService(client)
            val result =
                service.fetchHistoricalQuotesBatch(
                    mapOf("INVALID.SA" to "INVALID"),
                    LocalDate.of(2024, 1, 1)
                )
            result.shouldBeEmpty()
        }

        // ==================== fetchTdQuotesBatch ====================

        test("fetchTdQuotesBatch - empty tickers returns empty map") {
            val service = QuoteService(buildMockClient(emptyMap()))
            service.fetchTdQuotesBatch(emptyList()) shouldBe emptyMap()
        }

        test("fetchTdQuotesBatch - matches by title and maturity date") {
            val csvContent = loadFixture("tesouro_direto_sample.csv")
            val client =
                buildMockClient(
                    mapOf(
                        "precotaxatesourodireto.csv" to csvContent
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchTdQuotesBatch(listOf("Tesouro Selic;01/03/2029"))
            result shouldContainKey "Tesouro Selic;01/03/2029"
            // The latest date in the CSV is 03/03/2024, which has PU 14215,60
            result["Tesouro Selic;01/03/2029"]!! shouldBe (14215.60 plusOrMinus 0.01)
        }

        test("fetchTdQuotesBatch - invalid format (no semicolon) is skipped") {
            val csvContent = loadFixture("tesouro_direto_sample.csv")
            val client =
                buildMockClient(
                    mapOf(
                        "precotaxatesourodireto.csv" to csvContent
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchTdQuotesBatch(listOf("InvalidFormat"))
            result.shouldBeEmpty()
        }

        test("fetchTdQuotesBatch - no match returns empty") {
            val csvContent = loadFixture("tesouro_direto_sample.csv")
            val client =
                buildMockClient(
                    mapOf(
                        "precotaxatesourodireto.csv" to csvContent
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchTdQuotesBatch(listOf("Tesouro XYZ;01/01/2030"))
            result.shouldBeEmpty()
        }

        // ==================== fetchTdHistoricalQuotesBatch ====================

        test("fetchTdHistoricalQuotesBatch - empty list returns empty map") {
            val service = QuoteService(buildMockClient(emptyMap()))
            service.fetchTdHistoricalQuotesBatch(emptyList()) shouldBe emptyMap()
        }

        test("fetchTdHistoricalQuotesBatch - returns sorted historical records") {
            val csvContent = loadFixture("tesouro_direto_sample.csv")
            val client =
                buildMockClient(
                    mapOf(
                        "precotaxatesourodireto.csv" to csvContent
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchTdHistoricalQuotesBatch(listOf("Tesouro Selic;01/03/2029"))
            result shouldContainKey "Tesouro Selic;01/03/2029"
            val records = result["Tesouro Selic;01/03/2029"]!!
            records shouldHaveSize 3 // 3 dates for Tesouro Selic 01/03/2029
            // verify sorted by date
            records.zipWithNext().forEach { (a, b) -> (a.first <= b.first) shouldBe true }
            records[0].second shouldBe (14205.32 plusOrMinus 0.01)
            records[1].second shouldBe (14210.45 plusOrMinus 0.01)
            records[2].second shouldBe (14215.60 plusOrMinus 0.01)
        }

        test("fetchTdHistoricalQuotesBatch - invalid format (no semicolon) is skipped") {
            val csvContent = loadFixture("tesouro_direto_sample.csv")
            val client =
                buildMockClient(
                    mapOf(
                        "precotaxatesourodireto.csv" to csvContent
                    )
                )
            val service = QuoteService(client)
            val result = service.fetchTdHistoricalQuotesBatch(listOf("NoSemicolon"))
            result.shouldBeEmpty()
        }

        test("fetchTdHistoricalQuotesBatch - multiple TD tickers") {
            val csvContent = loadFixture("tesouro_direto_sample.csv")
            val client =
                buildMockClient(
                    mapOf(
                        "precotaxatesourodireto.csv" to csvContent
                    )
                )
            val service = QuoteService(client)
            val result =
                service.fetchTdHistoricalQuotesBatch(
                    listOf(
                        "Tesouro Selic;01/03/2029",
                        "Tesouro Prefixado;01/01/2027"
                    )
                )
            result shouldContainKey "Tesouro Selic;01/03/2029"
            result shouldContainKey "Tesouro Prefixado;01/01/2027"
            result["Tesouro Prefixado;01/01/2027"]!! shouldHaveSize 3
        }
    })
