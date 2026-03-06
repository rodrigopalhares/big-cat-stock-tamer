package com.stocks.service

import io.kotest.core.spec.IsolationMode
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.maps.shouldContainKey
import io.kotest.matchers.shouldBe
import org.hamcrest.Matchers.containsString
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withResourceNotFound
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import java.time.LocalDate

private fun loadFixture(name: String): String = QuoteServiceTest::class.java.getResource("/fixtures/$name")!!.readText()

class QuoteServiceTest :
    FunSpec({
        isolationMode = IsolationMode.InstancePerTest

        val builder = RestClient.builder()
        val mockServer = MockRestServiceServer.bindTo(builder).build()
        val restClient = builder.build()
        val service = QuoteService(restClient)

        afterEach {
            mockServer.reset()
        }

        // ==================== fetchQuotesBatch ====================

        test("fetchQuotesBatch - empty tickers returns empty map") {
            service.fetchQuotesBatch(emptyList()) shouldBe emptyMap()
        }

        test("fetchQuotesBatch - single ticker returns price from regularMarketPrice") {
            mockServer
                .expect(requestTo(containsString("PETR3.SA")))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(loadFixture("yahoo_chart_petr3.json"), MediaType.APPLICATION_JSON))

            val result = service.fetchQuotesBatch(listOf("PETR3.SA"))
            result shouldContainKey "PETR3.SA"
            result["PETR3.SA"]!! shouldBe (38.45 plusOrMinus 0.01)
        }

        test("fetchQuotesBatch - multiple tickers returns all prices") {
            mockServer
                .expect(requestTo(containsString("PETR3.SA")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_petr3.json"), MediaType.APPLICATION_JSON))
            mockServer
                .expect(requestTo(containsString("BOVA11.SA")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_etf.json"), MediaType.APPLICATION_JSON))

            val result = service.fetchQuotesBatch(listOf("PETR3.SA", "BOVA11.SA"))
            result shouldContainKey "PETR3.SA"
            result shouldContainKey "BOVA11.SA"
            result["PETR3.SA"]!! shouldBe (38.45 plusOrMinus 0.01)
            result["BOVA11.SA"]!! shouldBe (128.50 plusOrMinus 0.01)
        }

        test("fetchQuotesBatch - ticker with zero price is excluded") {
            mockServer
                .expect(requestTo(containsString("ZERO3.SA")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_zero_price.json"), MediaType.APPLICATION_JSON))

            val result = service.fetchQuotesBatch(listOf("ZERO3.SA"))
            result.shouldBeEmpty()
        }

        test("fetchQuotesBatch - API error returns empty map (graceful degradation)") {
            mockServer
                .expect(requestTo(containsString("INVALID")))
                .andRespond(withResourceNotFound())

            val result = service.fetchQuotesBatch(listOf("INVALID"))
            result.shouldBeEmpty()
        }

        // ==================== fetchAssetInfo ====================

        test("fetchAssetInfo - PETR3 returns name, type=STOCK, yfTicker=PETR3.SA, currency=BRL") {
            mockServer
                .expect(requestTo(containsString("PETR3.SA")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_petr3.json"), MediaType.APPLICATION_JSON))

            val info = service.fetchAssetInfo("PETR3")
            info.name shouldBe "Petróleo Brasileiro S.A. - Petrobras"
            info.type shouldBe "STOCK"
            info.yfTicker shouldBe "PETR3.SA"
            info.currency shouldBe "BRL"
        }

        test("fetchAssetInfo - ETF instrumentType returns type=ETF") {
            mockServer
                .expect(requestTo(containsString("BOVA11.SA")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_etf.json"), MediaType.APPLICATION_JSON))

            val info = service.fetchAssetInfo("BOVA11")
            info.type shouldBe "ETF"
            info.yfTicker shouldBe "BOVA11.SA"
        }

        test("fetchAssetInfo - unknown ticker returns fallback AssetInfo") {
            mockServer
                .expect(requestTo(containsString("XYZW99.SA")))
                .andRespond(withResourceNotFound())
            mockServer
                .expect(requestTo(containsString("XYZW99")))
                .andRespond(withResourceNotFound())

            val info = service.fetchAssetInfo("XYZW99")
            info.name shouldBe "XYZW99"
            info.type shouldBe "STOCK"
            info.yfTicker shouldBe "XYZW99.SA"
            info.currency shouldBe "BRL"
        }

        test("fetchAssetInfo - USD currency is preserved") {
            // "AAPL" has no dot, so it tries AAPL.SA first (fail), then AAPL (hit)
            mockServer
                .expect(requestTo(containsString("AAPL.SA")))
                .andRespond(withResourceNotFound())
            mockServer
                .expect(requestTo(containsString("AAPL")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_usd_asset.json"), MediaType.APPLICATION_JSON))

            val info = service.fetchAssetInfo("AAPL")
            info.currency shouldBe "USD"
            info.name shouldBe "Apple Inc."
        }

        test("fetchAssetInfo - non-BRL/USD currency defaults to BRL") {
            mockServer
                .expect(requestTo(containsString("SAP.DE")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_eur_asset.json"), MediaType.APPLICATION_JSON))

            val info = service.fetchAssetInfo("SAP.DE")
            info.currency shouldBe "BRL"
        }

        // ==================== fetchExchangeRate ====================

        test("fetchExchangeRate - same currency returns 1.0") {
            service.fetchExchangeRate("BRL", "BRL") shouldBe 1.0
        }

        test("fetchExchangeRate - different currency fetches rate from API") {
            mockServer
                .expect(requestTo(containsString("USDBRL=X")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_usdbrl.json"), MediaType.APPLICATION_JSON))

            val rate = service.fetchExchangeRate("USD", "BRL")
            rate shouldBe (5.85 plusOrMinus 0.01)
        }

        test("fetchExchangeRate - cached rate is reused within 5 minutes") {
            mockServer
                .expect(requestTo(containsString("USDBRL=X")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_usdbrl.json"), MediaType.APPLICATION_JSON))

            val rate1 = service.fetchExchangeRate("USD", "BRL")
            val rate2 = service.fetchExchangeRate("USD", "BRL")
            rate1 shouldBe (5.85 plusOrMinus 0.01)
            rate2 shouldBe (5.85 plusOrMinus 0.01)

            // If the cache didn't work, mockServer.verify() would fail because only 1 expectation was set
            mockServer.verify()
        }

        test("fetchExchangeRate - returns fallback 6.0 when API fails") {
            mockServer
                .expect(requestTo(containsString("USDBRL=X")))
                .andRespond(withResourceNotFound())

            val rate = service.fetchExchangeRate("USD", "BRL")
            rate shouldBe 6.0
        }

        // ==================== fetchHistoricalQuotesBatch ====================

        test("fetchHistoricalQuotesBatch - empty map returns empty map") {
            service.fetchHistoricalQuotesBatch(emptyMap(), LocalDate.now()) shouldBe emptyMap()
        }

        test("fetchHistoricalQuotesBatch - returns sorted list of date-close pairs, skipping nulls and negatives") {
            mockServer
                .expect(requestTo(containsString("PETR3.SA")))
                .andRespond(withSuccess(loadFixture("yahoo_chart_historical.json"), MediaType.APPLICATION_JSON))

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
            mockServer
                .expect(requestTo(containsString("INVALID.SA")))
                .andRespond(withResourceNotFound())

            val result =
                service.fetchHistoricalQuotesBatch(
                    mapOf("INVALID.SA" to "INVALID"),
                    LocalDate.of(2024, 1, 1)
                )
            result.shouldBeEmpty()
        }

        // ==================== fetchTdQuotesBatch ====================

        test("fetchTdQuotesBatch - empty tickers returns empty map") {
            service.fetchTdQuotesBatch(emptyList()) shouldBe emptyMap()
        }

        test("fetchTdQuotesBatch - matches by title and maturity date") {
            mockServer
                .expect(requestTo(containsString("precotaxatesourodireto.csv")))
                .andRespond(withSuccess(loadFixture("tesouro_direto_sample.csv"), MediaType.valueOf("text/csv")))

            val result = service.fetchTdQuotesBatch(listOf("Tesouro Selic;01/03/2029"))
            result shouldContainKey "Tesouro Selic;01/03/2029"
            // The latest date in the CSV is 03/03/2024, which has PU 14215,60
            result["Tesouro Selic;01/03/2029"]!! shouldBe (14215.60 plusOrMinus 0.01)
        }

        // ==================== fetchTdHistoricalQuotesBatch ====================

        test("fetchTdHistoricalQuotesBatch - returns sorted historical records") {
            mockServer
                .expect(requestTo(containsString("precotaxatesourodireto.csv")))
                .andRespond(withSuccess(loadFixture("tesouro_direto_sample.csv"), MediaType.valueOf("text/csv")))

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
    })
