# SmartSite Foundation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Existing user authorization covers implementation and draft PRs.

**Goal:** Establish runnable Web/API/Mobile/AI foundations with reproducible local setup and automated checks.

**Architecture:** A TypeScript application monorepo plus a separate Python AI service. Backend owns business permissions and database access; AI produces observations and supplementary evidence analysis in later milestones.

**Tech Stack:** React/Vite, NestJS/PostgreSQL, Expo/React Native, TanStack Query, FastAPI, pnpm/Turbo, uv, Docker.

**Spec:** `docs/superpowers/specs/2026-09-18-foundation-design.md`

## Global Constraints

- No Flutter, Supabase, RTK Query, automatic branch deletion, secrets, model downloads or billable API calls.
- Node 24 LTS; stable compatible versions locked, not blanket `latest` installs.
- Existing model proposals are experimental, never advertise active camera inference in this milestone.
- Isolated branches `codex/project-foundation` in sibling worktrees.

## Task 1: Workspace and Web/client (controller)

Files: root package/config/lock, `apps/web`, `packages/api-client`, CI and Compose.
Interface: GET `/api/v1/health/live` returns `{status:'ok',service:'smartsite-backend'}`.

- [x] Configure pnpm workspace, Turbo, strict TS and shared lint/format scripts.
- [x] Write health client tests covering valid response, malformed response, non-2xx and timeout before implementing `getBackendHealth(baseUrl, options)`.
- [x] Build React shell using QueryProvider and a status panel with loading/error/retry and no synthetic domain data.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Task 2: Backend (independent implementer)

Files: only `apps/backend/**`.
Interfaces: live health above; readiness 200 when DB reachable and 503 when unavailable; OpenAPI at `/api/docs` in development; port 3000.

- [x] Configure NestJS build/dev/test and database adapter compatible with Neon; write and observe failing HTTP/config tests.
- [x] Implement validated config, process/database health, graceful shutdown and exact CORS origin allowlist.
- [x] Document database migrations and current absence of domain schema; do not invent entities merely to demonstrate ORM.
- [x] Run backend tests/typecheck/build and commit changes scoped to backend.

## Task 3: Mobile (independent implementer)

Files: only `apps/mobile/**`.
Consumes shared health client above. Use Expo Router, QueryProvider and `EXPO_PUBLIC_API_URL`.

- [x] Resolve stable Expo template package versions and create a minimal screen without boilerplate demos.
- [x] Configure error/loading states, dev client scripts and LAN URL guidance.
- [x] Run TypeScript, Expo dependency check and bundle export; report device tests honestly.

## Task 4: AI (independent implementer, separate repo)

Files: `smartsite-ai` only.
Interface: GET `/health/live`, `/health/ready`, `/v1/capabilities`; port 8000; ready describes API service, not inference readiness.

- [x] Create uv package/lock and health/config tests before runtime implementation.
- [x] Implement FastAPI app factory, validated config and honest capability states; optional YOLO/Supervision extras, no automatic model load.
- [x] Add non-root Docker image, CI and onboarding docs. Run Ruff/pytest/build and runtime smoke check.

## Task 5: Integration, review and delivery (controller + reviewer)

- [x] Add Dockerfiles/Compose with local Postgres and optional sibling AI profile; environment examples contain no secrets.
- [x] Update READMEs and stack decisions with resolved versions, exact startup and scope limits.
- [x] Test lockfile installs, all application checks, live HTTP, mobile export and container builds where environment permits.
- [x] Independent review of both diffs; fix material findings and rerun affected checks.
- [x] Commit and push foundation branches, open draft PRs; preserve branches and do not merge.

## Verification record

2026-09-18: pnpm check passed (5 HTTP client tests, 12 Backend config/HTTP tests, Web/API build and Android+iOS JS export). Frozen install, peer checks, Expo dependency check and Prisma validation passed. FastAPI Ruff, 13 tests and wheel/sdist build passed. Docker Compose Web/API/Postgres/AI all healthy; Backend readiness confirms real Postgres. Browser Web shows Backend online. No physical device, camera/GPU inference, Neon connection or OpenAI call tested. Independent review fixed Turbo dev environment forwarding and dotenv build-cache inputs. Nest12 package ESM required ESM backend (initial CJS proposal corrected). PR delivery is recorded in GitHub rather than requiring merge.
