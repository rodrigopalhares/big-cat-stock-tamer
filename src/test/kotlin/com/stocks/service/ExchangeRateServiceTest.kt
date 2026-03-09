package com.stocks.service

import com.ninjasquad.springmockk.MockkBean
import com.stocks.dto.BcbPtaxQuote
import com.stocks.dto.BcbPtaxResponse
import com.stocks.model.AssetEntity
import com.stocks.model.ExchangeRates
import com.stocks.model.TransactionEntity
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.extensions.ApplyExtension
import io.kotest.core.spec.IsolationMode
import io.kotest.core.spec.style.FunSpec
import io.kotest.extensions.spring.SpringExtension
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import org.hamcrest.Matchers.containsString
import org.jetbrains.exposed.v1.jdbc.deleteAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.ParameterizedTypeReference
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

private fun mockBcbResponse(
    restClient: RestClient,
    response: BcbPtaxResponse,
) {
    val mockSpec = mockk<RestClient.RequestHeadersUriSpec<*>>()
    val mockRetrieve = mockk<RestClient.ResponseSpec>()
    every { restClient.get() } returns mockSpec
    every { mockSpec.uri(any<String>()) } returns mockSpec
    every { mockSpec.retrieve() } returns mockRetrieve
    every { mockRetrieve.hint(any(), any()) } returns mockRetrieve
    every { mockRetrieve.body(any<ParameterizedTypeReference<*>>()) } returns response
}

// ==================== Unit Tests (pure RestClient mock, no Spring context) ====================

class FetchRangeFromBcbTest :
    FunSpec({
        isolationMode = IsolationMode.InstancePerTest

        val builder = RestClient.builder()
        val mockServer = MockRestServiceServer.bindTo(builder).build()
        val restClient = builder.build()
        val service = ExchangeRateService(restClient)

        afterEach {
            mockServer.reset()
        }

        test("parses BCB PTAX period response from fixture") {
            mockServer
                .expect(requestTo(containsString("CotacaoDolarPeriodo")))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(loadFixture("bcb_ptax_period.json"), MediaType.APPLICATION_JSON))

            val result =
                service.fetchRangeFromBcb(
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
                service.fetchRangeFromBcb(
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
                service.fetchRangeFromBcb(
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
    @MockkBean private val restClient: RestClient,
) : FunSpec({

        beforeEach {
            transaction {
                ExchangeRates.deleteAll()
                TransactionEntity.all().forEach { it.delete() }
                AssetEntity.all().forEach { it.delete() }
            }
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
            mockBcbResponse(restClient, BcbPtaxResponse(value = emptyList()))

            transaction {
                AssetEntity.new("AAPL") {
                    name = "Apple"
                    type = "INTERNATIONAL"
                    currency = "USD"
                }
                TransactionEntity.new {
                    assetId = "AAPL"
                    type = "BUY"
                    quantity = 10.0
                    price = 150.0
                    date = LocalDate.of(2026, 3, 1)
                }
            }

            val rate = exchangeRateService.getRate("USD", "BRL", LocalDate.of(2026, 3, 9))
            rate shouldBe (5.85 plusOrMinus 0.01)
        }

        test("getRate - throws error when no rate exists and BCB returns empty") {
            mockBcbResponse(restClient, BcbPtaxResponse(value = emptyList()))

            shouldThrow<IllegalStateException> {
                exchangeRateService.getRate("USD", "BRL", LocalDate.of(2026, 3, 7))
            }
        }

        test("getRate - backfills from BCB and stores in DB") {
            mockBcbResponse(
                restClient,
                BcbPtaxResponse(
                    value =
                        listOf(
                            BcbPtaxQuote(5.7908, 5.7914, "2025-03-05 15:36:28.199"),
                            BcbPtaxQuote(5.7483, 5.7489, "2025-03-06 13:11:00.814"),
                            BcbPtaxQuote(5.7682, 5.7688, "2025-03-07 13:08:41.977"),
                        ),
                ),
            )

            transaction {
                AssetEntity.new("AAPL") {
                    name = "Apple"
                    type = "INTERNATIONAL"
                    currency = "USD"
                }
                TransactionEntity.new {
                    assetId = "AAPL"
                    type = "BUY"
                    quantity = 10.0
                    price = 150.0
                    date = LocalDate.of(2025, 3, 5)
                }
            }

            val rate = exchangeRateService.getRate("USD", "BRL", LocalDate.of(2025, 3, 6))
            rate shouldBe (5.7489 plusOrMinus 0.001)

            // Verify it was stored in DB
            val storedRate = exchangeRateService.findRate("USD", "BRL", LocalDate.of(2025, 3, 6))
            storedRate shouldBe (5.7489 plusOrMinus 0.001)
        }
    })
