# Stocks Application

A personal stock portfolio tracking application built with Kotlin and Spring Boot.

## Development Commands

- **Build**: `./gradlew build`
- **Run**: `./gradlew bootRun`
- **Test**: `./gradlew test`
- **Linter**: `./gradlew ktlintCheck`
- **Linter Fix**: `./gradlew ktlintFormat`

## Core Guidelines

- **Kotlin First**: Use Kotlin-idiomatic patterns (extension functions, data classes, null safety).
- **Simplicity**: Prefer simple solutions over complex abstractions.
- **English Code**: All code (variables, functions, classes, comments) must be in English.
- **Portuguese UI**: User interface (templates, labels, error messages) can remain in Portuguese.
- **Surgical Changes**: Make focused changes and ensure verification with tests.
- **Tests Required**: When creating or modifying a feature, always create or update the corresponding tests.
- **Skills Maintenance**: When a feature has an associated skill (in `.claude/skills/`), update the skill if the changes affect its scope.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Kotlin (JDK 21+) |
| Backend | Spring Boot 3.4 |
| ORM / DB | Exposed (DAO + DSL) + H2 |
| Migrations | Flyway |
| Templates | Thymeleaf + HTMX |
| CSS | Bootstrap 5 |
| HTTP Client | RestClient (Spring) |
| JSON | Jackson |
| CSV | kotlin-csv-jvm |
| Scheduler | Spring @Scheduled |
| Tests | Kotest + MockK + SpringMockK + MockRestServiceServer |
| Build | Gradle (Kotlin DSL) |
| Linter | ktlint |

## Architecture

- **Controller**: Handles web requests and HTMX partials.
- **Service**: Contains business logic and transaction boundaries.
- **DTO**: Data Transfer Objects for API and internal data movement.
- **Model**: Exposed DAO entities and table definitions.
- **Config**: Application configuration (Security, HTTP, etc.).

## Database

- Uses H2 file-based database stored in `./data/stocks.mv.db`.
- Flyway migrations are located in `src/main/resources/db/migration`.
