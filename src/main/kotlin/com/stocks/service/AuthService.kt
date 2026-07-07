package com.stocks.service

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64

/**
 * Simple single-user authentication.
 *
 * The password is configured via the `APP_AUTH_PASSWORD` environment variable. Successful logins
 * generate a random session token whose hash is persisted to a local `.key` file, so the
 * session survives service restarts and the user does not need to log in again.
 */
@Service
class AuthService(
    @Value("\${app.auth.password:}") private val password: String,
    @Value("\${app.auth.key-file:./data/auth.key}") keyFilePath: String,
    @Value("\${app.auth.session-days:365}") private val sessionDays: Long,
) {
    private val log = LoggerFactory.getLogger(AuthService::class.java)
    private val keyFile: Path = Path.of(keyFilePath)
    private val random = SecureRandom()
    private val lock = Any()

    /** When no password is configured, authentication is disabled and every request is allowed. */
    val authEnabled: Boolean = password.isNotBlank()

    init {
        if (!authEnabled) {
            log.warn("APP_AUTH_PASSWORD is not set — authentication is DISABLED. Set it in .env to protect the app.")
        }
    }

    /**
     * Validates the password and, on success, creates a persistent session.
     * @return the raw session token to be stored in the browser cookie, or null if the password is wrong.
     */
    fun login(rawPassword: String): String? {
        if (!authEnabled) return null
        if (!constantTimeEquals(rawPassword, password)) return null

        val token = generateToken()
        val expiresAt = Instant.now().plusSeconds(sessionDays * 86_400)
        synchronized(lock) {
            val sessions = readSessions().filterNot { it.isExpired() }
            writeSessions(sessions + Session(hash(token), expiresAt.epochSecond))
        }
        return token
    }

    /** Returns true if the token matches a stored, non-expired session. */
    fun isValid(token: String?): Boolean {
        if (!authEnabled) return true
        if (token.isNullOrBlank()) return false
        val hashed = hash(token)
        synchronized(lock) {
            val sessions = readSessions()
            val valid = sessions.filterNot { it.isExpired() }
            // Opportunistically prune expired sessions.
            if (valid.size != sessions.size) writeSessions(valid)
            return valid.any { constantTimeEquals(it.tokenHash, hashed) }
        }
    }

    /** Removes the session associated with the given token, if any. */
    fun logout(token: String?) {
        if (token.isNullOrBlank()) return
        val hashed = hash(token)
        synchronized(lock) {
            val remaining = readSessions().filterNot { it.isExpired() || it.tokenHash == hashed }
            writeSessions(remaining)
        }
    }

    private data class Session(
        val tokenHash: String,
        val expiresAtEpoch: Long,
    ) {
        fun isExpired(): Boolean = expiresAtEpoch < Instant.now().epochSecond
    }

    private fun readSessions(): List<Session> {
        if (!Files.exists(keyFile)) return emptyList()
        return Files
            .readAllLines(keyFile)
            .mapNotNull { line ->
                val parts = line.trim().split(":")
                if (parts.size == 2) {
                    parts[1].toLongOrNull()?.let { Session(parts[0], it) }
                } else {
                    null
                }
            }
    }

    private fun writeSessions(sessions: List<Session>) {
        keyFile.parent?.let { Files.createDirectories(it) }
        Files.write(keyFile, sessions.map { "${it.tokenHash}:${it.expiresAtEpoch}" })
    }

    private fun generateToken(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun hash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun constantTimeEquals(
        a: String,
        b: String,
    ): Boolean = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())
}
