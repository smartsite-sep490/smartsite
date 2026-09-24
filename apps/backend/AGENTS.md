# Backend engineering guide

Read the root `AGENTS.md`, this guide, and `README.md` before changing the backend. This guide supplements the repository contract.

## Ownership and imports

- `app.module.ts` composes modules; `configure-app.ts` owns shared HTTP bootstrap for runtime and tests.
- `config/` owns validated runtime and migration configuration. `database/` owns TypeORM connection, entities, and migrations.
- `common/http/` owns request IDs and public errors. `observability/` owns logger configuration and sanitization.
- `modules/health` owns liveness/readiness; `modules/auth` owns user sessions and AI service authentication; `modules/users` owns account management.
- `modules/zones` resolves observation context and Zone authorization; `modules/safety/alerts` evaluates and groups alerts.
- `modules/sites` owns Site metadata; `modules/cameras` owns Camera, observation Region, revision updates, and AI configuration snapshots. `modules/zones` also owns Zone policy and its permanent lock after a Region is linked.
- `integrations/ai` owns ingestion orchestration, raw payload preservation, idempotency, and the transaction boundary.
- Add feature modules only with real behavior. Import a module's exported service instead of its persistence internals. Export only providers with consumers; import DatabaseModule explicitly when needed.
- Configuration controllers require an active Admin account that has changed its temporary password. Admin is global across Sites in this milestone; Worker has no configuration permissions. A Site ID never proves user authorization. AI snapshot reads require a service token and an explicit camera allowlist.
- A software account is not a camera identity or a Worker business record. Never treat track IDs or login roles as proof of Zone-entry permission. Store only salted password hashes and hashed session tokens; revoke sessions on reset, password change and account disable.
- Every Region or Camera-status mutation checks the expected camera revision and updates revisions in one PostgreSQL transaction. A linked Zone's policy stays locked even after its Regions are deactivated.
- Use relative ESM imports with `.js` extensions. Do not create empty folders, generic repositories, base services, forwarding layers, or dependencies for hypothetical needs.

## Growing the backend

Choose the simplest structure that meets current requirements. Each new layer, dependency, or module boundary must solve a concrete problem. Simplicity must preserve validation, authorization, transaction safety, and meaningful tests.

- Keep small features simple: add controllers, services, and DTOs as needed. Do not require every feature to have `application/`, `domain/`, `infrastructure/`, or `repositories/` folders; separation of responsibilities still applies.
- Split services when they contain independent responsibilities, are difficult to test in isolation, or change for unrelated reasons. Do not split solely to satisfy a line-count limit or make every feature look identical.
- Move technical helpers into `common/` only when they have real consumers and shared meaning. Similar-looking code alone does not justify an abstraction. Business rules remain in their owning feature and are reused through its exported providers.
- Add subfolders such as `dto/`, `guards/`, `policies/`, or `common/http/filters/` when actual code needs grouping. Keep a small set of related files together until that grouping improves navigation.
- Add a nested `AGENTS.md` only for substantial, lasting rules specific to that module, such as AI raw-payload and idempotency invariants. Document only the additional rules; do not copy parent guidance or create a guide for every folder. Update ownership and guidance when module responsibilities change.

## Configuration and HTTP boundaries

- Change env fields in the Zod schema, inferred types, examples, documentation, and regression tests together. Use typed ConfigService in services; do not scatter `process.env` reads or unvalidated fallbacks.
- Migration configuration must remain independent of HTTP, service tokens, and logging. Never enable `synchronize` or automatic startup migrations.
- Preserve one request ID across response headers, logs, and error bodies, including errors before controllers. Never regenerate it in the filter.
- Keep the public error envelope stable. Only explicitly allowed details may leave the server; no SQL, driver errors, credentials, or stack traces.
- Logs must omit body, raw evidence, query strings, tokens, and database URLs. Sanitize error messages and causes as well as headers.
- Validate DTO input at the HTTP boundary with whitelist and forbidden unknown properties. Convert types explicitly. AI payloads stay untouched until canonical contract validation and hashing.
- AI observations are evidence, not authorization decisions. Keep fail-closed role/data scope semantics; a tracker ID is not a Worker ID.

## Tests and changes

- Unit/HTTP tests run with `NODE_ENV=test` before imports and never load local runtime env or connect to a runtime database.
- Integration tests use only validated `TEST_DATABASE_URL` and the dedicated test DataSource; never import the runtime/CLI DataSource. Migrate the test database once before sequential suites.
- Preserve existing raw payload, hashing, transaction, idempotency, grouping, and concurrency tests. Schema changes require a reviewed migration and real PostgreSQL integration tests.
- New features need role plus Site/Contractor/Zone scope checks and happy, denied, missing/unavailable data, and cross-scope cases.
- Run the smallest relevant test first, then `pnpm peers check`, `pnpm check`, `pnpm --filter @smartsite/mobile check:dependencies`, and `pnpm --filter @smartsite/backend test:integration` as applicable. Verify frozen installation, changed-file formatting, and Compose readiness for dependency/runtime changes.
- Report actual commands and results, including blocked Docker/database checks. A passing build alone is insufficient; another team member must review the change.
