package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe

class TickerPatternTest :
    FunSpec({

        // --- Tesouro Direto ---

        test("classifyTicker - Tesouro Direto with semicolon") {
            val result = classifyTicker("Tesouro Selic;01/03/2029")
            result.suggestedType shouldBe "TESOURO_DIRETO"
            result.yfCandidates shouldBe listOf("Tesouro Selic;01/03/2029")
            result.defaultCurrency shouldBe "BRL"
        }

        // --- International with dot suffix ---

        test("classifyTicker - SAP.DE is INTERNATIONAL") {
            val result = classifyTicker("SAP.DE")
            result.suggestedType shouldBe "INTERNATIONAL"
            result.yfCandidates shouldBe listOf("SAP.DE")
            result.defaultCurrency shouldBe "USD"
        }

        test("classifyTicker - VOW3.DE is INTERNATIONAL") {
            val result = classifyTicker("VOW3.DE")
            result.suggestedType shouldBe "INTERNATIONAL"
            result.yfCandidates shouldBe listOf("VOW3.DE")
            result.defaultCurrency shouldBe "USD"
        }

        // --- Crypto ---

        test("classifyTicker - BTC-USD is CRYPTO") {
            val result = classifyTicker("BTC-USD")
            result.suggestedType shouldBe "CRYPTO"
            result.yfCandidates shouldBe listOf("BTC-USD")
            result.defaultCurrency shouldBe "USD"
        }

        test("classifyTicker - ETH-BRL is CRYPTO") {
            val result = classifyTicker("ETH-BRL")
            result.suggestedType shouldBe "CRYPTO"
            result.yfCandidates shouldBe listOf("ETH-BRL")
            result.defaultCurrency shouldBe "USD"
        }

        // --- FII/ETF BR (ends in 11) ---

        test("classifyTicker - HGLG11 is FII or ETF (null type)") {
            val result = classifyTicker("HGLG11")
            result.suggestedType shouldBe null
            result.yfCandidates shouldBe listOf("HGLG11.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        test("classifyTicker - BOVA11 is FII or ETF (null type)") {
            val result = classifyTicker("BOVA11")
            result.suggestedType shouldBe null
            result.yfCandidates shouldBe listOf("BOVA11.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        test("classifyTicker - KNCRI11 (6 letters + 11) is FII or ETF") {
            val result = classifyTicker("KNCRI11")
            result.suggestedType shouldBe null
            result.yfCandidates shouldBe listOf("KNCRI11.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        // --- BDR (4 letters + 34-39) ---

        test("classifyTicker - AAPL34 is BDR") {
            val result = classifyTicker("AAPL34")
            result.suggestedType shouldBe "BDR"
            result.yfCandidates shouldBe listOf("AAPL34.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        test("classifyTicker - MSFT34 is BDR") {
            val result = classifyTicker("MSFT34")
            result.suggestedType shouldBe "BDR"
            result.yfCandidates shouldBe listOf("MSFT34.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        // --- BR Stock (4 letters + 1-2 digits) ---

        test("classifyTicker - PETR3 is STOCK") {
            val result = classifyTicker("PETR3")
            result.suggestedType shouldBe "STOCK"
            result.yfCandidates shouldBe listOf("PETR3.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        test("classifyTicker - VALE3 is STOCK") {
            val result = classifyTicker("VALE3")
            result.suggestedType shouldBe "STOCK"
            result.yfCandidates shouldBe listOf("VALE3.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        test("classifyTicker - ITUB4 is STOCK") {
            val result = classifyTicker("ITUB4")
            result.suggestedType shouldBe "STOCK"
            result.yfCandidates shouldBe listOf("ITUB4.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        // --- International (1-5 letters, no digits) ---

        test("classifyTicker - AAPL is INTERNATIONAL with fallback") {
            val result = classifyTicker("AAPL")
            result.suggestedType shouldBe "INTERNATIONAL"
            result.yfCandidates shouldBe listOf("AAPL", "AAPL.SA")
            result.defaultCurrency shouldBe "USD"
        }

        test("classifyTicker - MSFT is INTERNATIONAL with fallback") {
            val result = classifyTicker("MSFT")
            result.suggestedType shouldBe "INTERNATIONAL"
            result.yfCandidates shouldBe listOf("MSFT", "MSFT.SA")
            result.defaultCurrency shouldBe "USD"
        }

        test("classifyTicker - GOOGL is INTERNATIONAL with fallback") {
            val result = classifyTicker("GOOGL")
            result.suggestedType shouldBe "INTERNATIONAL"
            result.yfCandidates shouldBe listOf("GOOGL", "GOOGL.SA")
            result.defaultCurrency shouldBe "USD"
        }

        test("classifyTicker - V (single letter) is INTERNATIONAL") {
            val result = classifyTicker("V")
            result.suggestedType shouldBe "INTERNATIONAL"
            result.yfCandidates shouldBe listOf("V", "V.SA")
            result.defaultCurrency shouldBe "USD"
        }

        // --- BR stock edge case (4 letters + 2 digits) ---

        test("classifyTicker - XYZW99 matches BR stock pattern") {
            val result = classifyTicker("XYZW99")
            result.suggestedType shouldBe "STOCK"
            result.yfCandidates shouldBe listOf("XYZW99.SA")
            result.defaultCurrency shouldBe "BRL"
        }

        // --- Fallback ---

        test("classifyTicker - ABCDEF99 fallback (does not match any specific pattern)") {
            val result = classifyTicker("ABCDEF99")
            result.suggestedType shouldBe null
            result.yfCandidates shouldBe listOf("ABCDEF99.SA", "ABCDEF99")
            result.defaultCurrency shouldBe "BRL"
        }

        test("classifyTicker - lowercase ticker fallback") {
            val result = classifyTicker("abc123")
            result.suggestedType shouldBe null
            result.yfCandidates shouldBe listOf("abc123.SA", "abc123")
            result.defaultCurrency shouldBe "BRL"
        }
    })
