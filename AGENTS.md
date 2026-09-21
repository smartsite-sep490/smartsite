# SmartSite Engineering Contract

This file is the mandatory engineering guide for people and coding agents working in this repository. `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. A passing build does not override these rules.

## 1. Read before changing code

1. Read the issue, its MF/FR/UC references when applicable, this file, the root `README.md`, and the relevant architecture decision.
2. Inspect the existing implementation and tests before proposing a new pattern.
3. State the observable behavior and acceptance criteria before implementation.
4. Keep code and documentation consistent. Never claim a feature, model, device, benchmark, or deployment is complete without current evidence.
5. Ask for a product decision when requirements conflict. Do not silently invent business rules.

Instruction priority is: explicit task requirements, this file, repository documentation, then nearby code conventions. Security and data-boundary rules remain mandatory.

## 2. Current system boundaries

This repository owns the React Web app, React Native/Expo app, NestJS Backend, shared client/contracts, TypeORM persistence, and local infrastructure. Computer vision belongs in the separate `smartsite-ai` repository.

- Backend is the source of truth for accounts, roles, Site/Contractor/Zone scope, access authorization, alert state, incidents, attendance, and other business decisions.
- AI observations are technical evidence. They are not final authorization or violation decisions.
- A tracker ID is not a Worker ID. An unknown identity is not permission.
- YOLO11s is the MF05/MF06 detector baseline. Model accuracy and RTX 4060 throughput remain unproven until benchmarked.
- OpenAI supplies asynchronous evidence analysis and drafting assistance. It must not decide identity, Zone access, violations, or incident closure.

## 3. Repository and dependency architecture

```text
apps/web       React/Vite management UI
apps/backend   NestJS business API
apps/mobile    React Native/Expo application
packages       reusable platform packages
contracts      versioned cross-service contracts
infra          Docker and local orchestration
```

- Preserve the modular-monolith boundary. Add a module for real business behavior, not for an empty folder hierarchy.
- Dependencies point inward: transport/UI -> application/use case -> domain/policy -> persistence or external adapter.
- Do not import another module's persistence internals. Communicate through an exported service, use case, query, or reviewed contract.
- Prefer a small explicit interface over a generic base class, service locator, global singleton, or speculative framework.
- Do not add a library when the platform or a small local function solves the requirement clearly. New runtime dependencies require a reason in the PR.
- Stable compatible versions and committed lockfiles are required. Do not upgrade unrelated packages inside a feature PR.

## 4. Backend rules

Before changing `apps/backend`, also read [apps/backend/AGENTS.md](apps/backend/AGENTS.md) for backend module ownership, HTTP boundaries, and test isolation rules.

- Controllers handle HTTP concerns only: validated input, authentication context, status mapping, and response DTOs. Business rules belong in application/domain services.
- Validate every external input at the boundary. Reject unknown or malformed security-sensitive fields.
- Authorization MUST combine role and data scope. Loading a record by ID without verifying its Site/Contractor/Zone ownership is forbidden.
- Authorization and validation fail closed. `unknown`, unavailable identity, stale geometry, missing scope, or unavailable permission data must never become `allowed` by default.
- Use TypeORM Data Mapper patterns. Controllers must not query repositories or `DataSource` directly.
- `synchronize` MUST remain `false`. Every schema change requires a reviewed migration and an integration test for the resulting schema or behavior.
- Use a transaction where partial completion would violate an invariant. Keep transactions short and do not make remote calls while holding them.
- Commands that may be retried need explicit idempotency behavior. AI ingestion preserves the validated raw event payload and evidence references according to retention policy, detects duplicate IDs, and prevents duplicate business side effects.
- Return stable error codes/messages suitable for clients; do not expose SQL, stack traces, credentials, or internal connection details.
- Use UTC internally and RFC 3339 at service boundaries. Preserve the original event timestamp when required for audit.
- Structured logs should include correlation/event identifiers and safe operational context. Never log tokens, database URLs, face embeddings, or sensitive evidence.

## 5. Web and Mobile rules

- Organize UI by user-facing feature. Shared components are created only after real reuse exists.
- Use TanStack Query as the single owner of server state, caching, mutations, and invalidation.
- Redux Toolkit MAY hold shared client-only state. Do not add RTK Query or copy TanStack Query data into Redux slices.
- Components must not call the database, AI service, or OpenAI directly. They call the Backend through the shared API client.
- API request/response types come from the reviewed contract/client. Do not maintain handwritten duplicate DTOs in each app.
- Forms validate client-side for usability and Backend-side for authority. Client validation is never a security boundary.
- Loading, empty, error, retry, denied, and unavailable states are part of the feature, not optional polish.
- Preserve accessibility: semantic controls, visible focus, labels, keyboard support on Web, and adequate touch targets on Mobile.
- Do not force Web and Mobile to share visual components. Share contracts and domain vocabulary; use platform-appropriate UI.

## 6. Contracts and cross-repository changes

- `contracts/` defines the machine-readable boundary between Backend and `smartsite-ai`. The Backend still owns business interpretation.
- Contract changes start with examples and compatibility impact, then schema/types, producer tests, consumer tests, and documentation.
- The Backend copy in this repository is canonical. Contract work uses two phases because squash merge changes the source commit SHA: merge the reviewed canonical contract here first, then vendor the exact bytes from the resulting immutable `main` SHA into `smartsite-ai` and merge the AI PR.
- Linked PRs may be developed and reviewed in parallel, but AI provenance is finalized only after the canonical PR merges. Do not claim the cross-repository change complete until both sides pass their paired checks.
- Prefer backward-compatible additions. A breaking change requires a new version and a staged order: Backend accepts old and new versions, AI migrates, then old support is removed in a later change.
- Geometry must include the configured region identifier and version. AI must not provide trusted `zoneId`, access permission, or final violation state.
- Keep canonical hashing and golden vectors identical across runtimes. Never hand-edit a vendored schema without updating its provenance.

## 7. Security and data handling

- Secrets belong in runtime environment or an approved secret manager. Commit only fake `.env.example` values.
- Never commit real camera recordings, evidence, face images, embeddings, datasets with restricted data, or model weights.
- Use synthetic or explicitly permitted fixtures. Remove metadata that can identify a person or site.
- OpenAI keys and calls stay server-side. Automated tests must not call paid or production external services.
- Validate file type, size, ownership, and storage key before accepting or serving evidence.
- Do not weaken CORS, authentication, authorization, rate/size limits, TLS expectations, or audit logging to make a demo pass.

## 8. Testing and quality gates

Use the smallest meaningful test first, then run the complete affected suite. Tests must verify behavior, boundaries, and failure modes rather than mirror implementation details.

Before a PR that changes this repository, run:

```sh
pnpm install --frozen-lockfile
pnpm peers check
pnpm check
pnpm --filter @smartsite/mobile check:dependencies
```

When persistence or integration behavior changes, also run the relevant PostgreSQL migrations and integration tests. When containers or runtime configuration change, run the Compose build/readiness smoke test described in the README/CI workflow.

- New domain rules require focused unit tests.
- Database behavior requires real PostgreSQL integration tests where mocks would hide SQL, transaction, or constraint behavior.
- Authorization changes require allowed, denied, cross-scope, missing-scope, and unavailable-data cases.
- Bug fixes require a regression test that fails before the fix.
- Tests must be deterministic and independent of production credentials, paid APIs, live cameras, or GPU availability.
- Hardware-dependent validation is reported separately with hardware, versions, input, measurements, and limitations.

## 9. Git, issues, and parallel work

- Start from current `main`; do not commit directly to `main`.
- One issue describes one reviewable behavior with MF/FR/UC references when applicable, scope, acceptance criteria, and affected contracts.
- Use short-lived branches such as `feat/mf05-ppe-events`, `fix/mf06-stale-geometry`, or `docs/contract-versioning`. Coding agents may use their required prefix.
- One person owns a branch. Other members contribute through review or explicitly coordinated commits; never share an uncoordinated working tree.
- Keep a PR focused. Do not combine dependency upgrades, formatting sweeps, refactors, and product behavior unless inseparable.
- Use Conventional Commit-style messages. Explain behavior, migration/deployment order, security impact, and verification in the PR.
- Do not force-push shared branches, bypass failing checks, merge without the required review/authorization, or delete branches unless the team explicitly requests cleanup.
- Shared hotspots require coordination before editing: contracts, migrations, lockfiles, CI, root configuration, and public API types.
- Cross-repository work uses the same issue identifier and linked PRs. Do not assume the two PRs deploy atomically.

Recommended parallel boundaries for the first MF05/MF06 iteration:

- Camera ingestion owns camera connection, frame sampling, reconnect, and backpressure in `smartsite-ai`.
- Detector integration owns the YOLO11s adapter and normalized detections in `smartsite-ai`.
- Zone configuration owns Backend Site/Camera/Region/Zone configuration and authorization data.
- Safety UI owns review screens and uses approved API contracts or mocks until the Backend endpoint is available.

Camera ingestion and detector integration must agree on a small typed frame/detection interface before working independently. Neither should reach into the other's implementation.

## 10. Definition of Done

A change is done only when all applicable statements are true:

- Acceptance criteria and relevant business rules are implemented.
- Authorization and data scope are enforced on the Backend.
- Schema, migration, API contract, generated/shared client, UI, and documentation agree.
- Happy path and material failure paths have meaningful tests.
- Required local checks and CI pass with no unexplained failure.
- Secrets and sensitive artifacts are absent from the diff and Git history.
- Operational behavior is covered: logs, retries, idempotency, health/readiness, and rollback where applicable.
- The PR states what was verified and what still requires hardware, credentials, data, or another deployment.
- Another team member reviews the change.

## 11. Coding-agent rules

- Read this entire file before editing. If the AI tool does not automatically load `AGENTS.md`, attach or paste it into the task context.
- Inspect code and tests; do not guess file names, APIs, package versions, or completed behavior.
- Follow existing conventions unless the issue explicitly changes them.
- Do not broaden scope, redesign unrelated modules, generate placeholder layers, or create speculative abstractions.
- Do not suppress type, lint, migration, or test errors merely to obtain a green check.
- Do not report completion from code inspection alone. Run the required commands and cite the actual results.
- AI output always requires human review. Never provide production credentials or unrestricted personal/site data to a coding assistant.
