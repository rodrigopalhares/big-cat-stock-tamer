package com.stocks.service

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeEmpty
import java.nio.file.Files

class AuthServiceTest :
    FunSpec({

        fun newService(
            password: String = "s3cret",
            sessionDays: Long = 365,
        ): Pair<AuthService, java.nio.file.Path> {
            val keyFile = Files.createTempFile("auth-test", ".key")
            Files.deleteIfExists(keyFile) // start from a non-existent file
            return AuthService(password, keyFile.toString(), sessionDays) to keyFile
        }

        test("login with correct password returns a token") {
            val (service, _) = newService()
            val token = service.login("s3cret")
            token.shouldNotBeNull()
            token.shouldNotBeEmpty()
        }

        test("login with wrong password returns null") {
            val (service, _) = newService()
            service.login("wrong") shouldBe null
        }

        test("a valid token is accepted") {
            val (service, _) = newService()
            val token = service.login("s3cret")
            service.isValid(token) shouldBe true
        }

        test("unknown or blank tokens are rejected") {
            val (service, _) = newService()
            service.login("s3cret")
            service.isValid("not-a-real-token") shouldBe false
            service.isValid(null) shouldBe false
            service.isValid("") shouldBe false
        }

        test("session survives a service restart (persisted to file)") {
            val (service, keyFile) = newService()
            val token = service.login("s3cret").shouldNotBeNull()

            // Simulate a restart: brand new instance pointing at the same key file.
            val restarted = AuthService("s3cret", keyFile.toString(), 365)
            restarted.isValid(token) shouldBe true
        }

        test("logout invalidates the token") {
            val (service, _) = newService()
            val token = service.login("s3cret").shouldNotBeNull()
            service.isValid(token) shouldBe true

            service.logout(token)
            service.isValid(token) shouldBe false
        }

        test("expired sessions are rejected") {
            val (service, _) = newService(sessionDays = -1) // already expired
            val token = service.login("s3cret").shouldNotBeNull()
            service.isValid(token) shouldBe false
        }

        test("auth is disabled when no password is configured") {
            val (service, _) = newService(password = "")
            service.authEnabled shouldBe false
            // With auth disabled, everything is allowed and login yields no token.
            service.isValid(null) shouldBe true
            service.login("anything") shouldBe null
        }

        test("multiple sessions can be valid at the same time") {
            val (service, _) = newService()
            val first = service.login("s3cret").shouldNotBeNull()
            val second = service.login("s3cret").shouldNotBeNull()
            service.isValid(first) shouldBe true
            service.isValid(second) shouldBe true
        }
    })
