package com.stocks.service

import com.ninjasquad.springmockk.MockkBean
import com.stocks.clearAllData
import com.stocks.createAsset
import com.stocks.createTransaction
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.IsolationMode
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.shouldBe
import io.mockk.every
import org.hamcrest.Matchers.containsString
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withResourceNotFound
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import java.time.LocalDate

private fun loadFixture(name: String): String = FetchRangeFromBcbTest::class.java.getResource("/fixtures/$name")!!.readText()

// ==================== Unit Tests (pure RestClient mock, no Spring context) ====================

class FetchRangeFromBcbTest :
    FunSpec({
        isolationMode = IsolationMode.InstancePerTest

        val builder = RestClient.builder()
        val mockServer = MockRestServiceServer.bindTo(builder).build()
        val restClient = builder.build()
        val bcbClient = BcbPtaxClient(restClient)

        afterEach {
            mockServer.reset()
        }

        test("parses BCB PTAX period response from fixture") {
            mockServer
                .expect(requestTo(containsString("CotacaoDolarPeriodo")))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(loadFixture("bcb_ptax_period.json"), MediaType.APPLICATION_JSON))

            val result =
                bcbClient.fetchRange(
                    LocalDate.of(2025, 3, 3),
                    LocalDate.of(2025, 3, 7),
                )

            result shouldHaveSize 3
            result[0].first shouldBe LocalDate.of(2025, 3, 5)
            result[0].second.first shouldBe (5.7908 plusOrMinus 0.0001)
            result[0].second.second shouldBe (5.7914 plusOrMinus 0.0001)
            result[1].first shouldBe LocalDate.of(2025, 3, 6)
            result[1].second.second shouldBe (5.7489 plusOrMinus 0.0001)
            result[2].first shouldBe LocalDate.of(2025, 3, 7)
            result[2].second.second shouldBe (5.7688 plusOrMinus 0.0001)
        }

        test("returns empty list on API error") {
            mockServer
                .expect(requestTo(containsString("CotacaoDolarPeriodo")))
                .andRespond(withResourceNotFound())

            val result =
                bcbClient.fetchRange(
                    LocalDate.of(2025, 3, 3),
                    LocalDate.of(2025, 3, 7),
                )

            result shouldHaveSize 0
        }

        test("returns empty list when BCB returns no quotes") {
            mockServer
                .expect(requestTo(containsString("CotacaoDolarPeriodo")))
                .andRespond(withSuccess("""{"value": []}""", MediaType.APPLICATION_JSON))

            val result =
                bcbClient.fetchRange(
                    LocalDate.of(2025, 3, 3),
                    LocalDate.of(2025, 3, 7),
                )

            result shouldHaveSize 0
        }
    })

// ==================== Integration Tests (SpringBootTest for DB operations) ====================

@ApplyExtension(SpringExtension::class)
@SpringBootTest
@ActiveProfiles("test")
class ExchangeRateServiceIntegrationTest(
    private val exchangeRateService: ExchangeRateService,
    @MockkBean private val quoteService: QuoteService,
    @MockkBean private val bcbClient: BcbPtaxClient,
) : FunSpec({

        beforeEach {
            clearAllData()
        }

        test("getRate - same currency returns 1.0") {
            exchangeRateService.getRate("BRL", "BRL") shouldBe 1.0
        }

        test("getRate - returns rate from DB when present") {
            exchangeRateService.upsertRate(LocalDate.of(2026, 3, 5), "USD", "BRL", 5.80, 5.85)

            val rate = exchangeRateService.getRate("USD", "BRL", LocalDate.of(2026, 3, 5))
            rate shouldBe (5.85 plusOrMinus 0.01)
        }

        test("findRate - returns null when not in DB") {
            val rate = exchangeRateService.findRate("USD", "BRL", LocalDate.of(2026, 3, 5))
            rate shouldBe null
        }

        test("findClosestRate - returns most recent rate") {
            exchangeRateService.upsertRate(LocalDate.of(2026, 3, 3), "USD", "BRL", 5.70, 5.75)
            exchangeRateService.upsertRate(LocalDate.of(2026, 3, 5), "USD", "BRL", 5.80, 5.85)

            val rate = exchangeRateService.findClosestRate("USD", "BRL", LocalDate.of(2026, 3, 7))
            rate shouldBe (5.85 plusOrMinus 0.01)
        }

        test("upsertRate - inserts new rate") {
            exchangeRateService.upsertRate(LocalDate.of(2026, 3, 5), "USD", "BRL", 5.80, 5.85)

            val rate = exchangeRateService.findRate("USD", "BRL", LocalDate.of(2026, 3, 5))
            rate shouldBe (5.85 plusOrMinus 0.01)
        }

        test("upsertRate - updates existing rate") {
            exchangeRateService.upsertRate(LocalDate.of(2026, 3, 5), "USD", "BRL", 5.80, 5.85)
            exchangeRateService.upsertRate(LocalDate.of(2026, 3, 5), "USD", "BRL", 5.90, 5.95)

            val rate = exchangeRateService.findRate("USD", "BRL", LocalDate.of(2026, 3, 5))
            rate shouldBe (5.95 plusOrMinus 0.01)
        }

        test("getRate - falls back to closest rate when BCB returns empty") {
            exchangeRateService.upsertRate(LocalDate.of(2026, 3, 5), "USD", "BRL", 5.80, 5.85)
            every { bcbClient.fetchRange(any(), any()) } returns emptyList()

            createAsset("AAPL", name = "Apple", type = "INTERNATIONAL", currency = "USD")
            createTransaction("AAPL", price = 150.0, date = LocalDate.of(2026, 3, 1))

            val rate = exchangeRateService.getRate("USD", "BRL", LocalDate.of(2026, 3, 9))
            rate shouldBe (5.85 plusOrMinus 0.01)
        }

        test("getRate - throws error when no rate exists and BCB returns empty") {
            every { bcbClient.fetchRange(any(), any()) } returns emptyList()

            shouldThrow<IllegalStateException> {
                exchangeRateService.getRate("USD", "BRL", LocalDate.of(2026, 3, 7))
            }
        }

        test("getRate - backfills from BCB and stores in DB") {
            every { bcbClient.fetchRange(any(), any()) } returns
                listOf(
                    LocalDate.of(2025, 3, 5) to (5.7908 to 5.7914),
                    LocalDate.of(2025, 3, 6) to (5.7483 to 5.7489),
                    LocalDate.of(2025, 3, 7) to (5.7682 to 5.7688),
                )

            createAsset("AAPL", name = "Apple", type = "INTERNATIONAL", currency = "USD")
            createTransaction("AAPL", price = 150.0, date = LocalDate.of(2025, 3, 5))

            val rate = exchangeRateService.getRate("USD", "BRL", LocalDate.of(2025, 3, 6))
            rate shouldBe (5.7489 plusOrMinus 0.001)

            // Verify it was stored in DB
            val storedRate = exchangeRateService.findRate("USD", "BRL", LocalDate.of(2025, 3, 6))
            storedRate shouldBe (5.7489 plusOrMinus 0.001)
        }
    })
