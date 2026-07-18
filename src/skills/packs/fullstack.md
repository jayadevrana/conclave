# Skill: Full-stack web app

Conventions the builder MUST follow:
- Layered structure: routes/controllers → services → data access. No business logic in route handlers.
- Validate all external input at the boundary (e.g. zod/valibot); never trust request bodies/params.
- Config via environment (`process.env`) with a typed config module; never hardcode or commit secrets.
- Errors: central error-handling middleware; return correct HTTP status codes; no leaking stack traces to clients.
- Types: TypeScript `strict` where TS is used; explicit return types on public functions.
- Persistence: parameterized queries / an ORM; migrations for schema changes; never string-concat SQL.
- Tests: unit tests for services + at least one integration test per route (vitest/jest); make it runnable with a single `npm test`.
- API: RESTful, consistent JSON shapes, pagination for lists, idempotent PUT/DELETE.
- Deliver: runnable code, a `.env.example`, and a one-line run/test command.
