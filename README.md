# SmartSite

SmartSite is an AI-assisted construction site management platform for workforce operations, attendance, visitor access, safety monitoring, incident handling, environmental monitoring, work progress, and operational reporting.

The platform treats AI as a supporting capability. Business authorization, access decisions, alert verification, and incident lifecycle decisions remain under the SmartSite backend and authorized users.

## Repository Scope

This repository contains the main SmartSite application platform:

- **Web** — React management application.
- **Backend** — NestJS business API and application services.
- **Mobile** — React Native / Expo application for worker-facing workflows.
- **Contracts** — shared API and cross-service contracts.
- **Infrastructure** — Docker and local service orchestration.
- **Documentation** — architecture decisions and repository guides.

Computer-vision and AI workloads live in the companion repository: [smartsite-sep490/smartsite-ai](https://github.com/smartsite-sep490/smartsite-ai).

Before contributing or using a coding assistant, read [AGENTS.md](AGENTS.md) for the mandatory architecture, security, testing, Git, and code-quality rules, then follow [CONTRIBUTING.md](CONTRIBUTING.md) for the team workflow.

## Architecture

```text
Web (React)                      Mobile (React Native)
     \                                 /
      \                               /
       -------- NestJS Backend --------
                      |
           +----------+-----------+
           |                      |
  PostgreSQL / Neon       SmartSite AI Service
                                  |
                         RTSP / Detection
                         Tracking / PPE
                         Restricted Zones
                         Identity Experiments
                         OpenAI Evidence Analysis
```

The backend is the source of truth for Site and Zone assignments, worker and contractor state, access authorization, alert lifecycle, incident workflow, and role/data-scope enforcement. AI detections are supporting evidence, not final business conclusions.

## Technology Stack

| Area            | Technology                                |
| --------------- | ----------------------------------------- |
| Web             | React, TypeScript, Vite, TanStack Query   |
| Backend         | NestJS, TypeScript                        |
| Mobile          | React Native, Expo Router, TanStack Query |
| Database        | PostgreSQL                                |
| Hosted database | Neon                                      |
| Data access     | TypeORM (PostgreSQL)                      |
| API             | REST, OpenAPI                             |
| Monorepo        | pnpm workspaces, Turborepo                |
| Infrastructure  | Docker, Docker Compose                    |
| CI              | GitHub Actions                            |
| AI              | Separate FastAPI service                  |

## Repository Structure

```text
apps/
  web/              React web application
  backend/          NestJS backend
  mobile/           React Native / Expo application

packages/
  api-client/       Shared API client for Web and Mobile

contracts/          Cross-service contracts
docs/               Architecture decisions and repository guides
infra/              Dockerfiles and local Compose configuration
```

The current foundation contains shared infrastructure and the existing MF05/MF06 observation ingestion, Zone context and Safety evaluation modules. Further business modules are introduced together with reviewed domain workflows rather than as empty placeholders. See the [Backend guide](apps/backend/README.md) for module ownership and HTTP boundaries.

## Getting Started

### Prerequisites

- Node.js **24.x**
- pnpm **12.4.2**
- Docker with Docker Compose

Install the expected pnpm version:

```sh
npm install --global pnpm@12.4.2
```

Install dependencies:

```sh
pnpm install --frozen-lockfile
```

### Run Web and Backend locally

Copy the Backend example without replacing an existing configuration, start PostgreSQL, and apply migrations (PowerShell and Linux):

```sh
node -e "const fs=require('node:fs'); if (!fs.existsSync('apps/backend/.env')) fs.copyFileSync('apps/backend/.env.example','apps/backend/.env')"
docker compose -f infra/compose.yaml up -d postgres --wait --wait-timeout 60
pnpm --filter @smartsite/backend db:migrate:run
```

Start the development applications:

```sh
pnpm dev
```

Default development endpoints:

| Service           | URL                                       |
| ----------------- | ----------------------------------------- |
| Web               | http://localhost:5173                     |
| Backend liveness  | http://localhost:3000/api/v1/health/live  |
| Backend readiness | http://localhost:3000/api/v1/health/ready |
| Swagger UI        | http://localhost:3000/api/docs            |

### Run with Docker

```sh
docker compose -f infra/compose.yaml up -d --build --wait
```

To include the sibling AI repository, clone `smartsite-ai` next to this repository and run:

```sh
docker compose -f infra/compose.yaml --profile ai up -d --build --wait
```

For the MF05/MF06 presentation runtime with hidden AI processes, PID identity tracking, named camera
sources and secret-safe process handling, see
[Controlled local demo runtime](docs/operations/controlled-demo-runtime.md).

The AI API is then available at http://localhost:8000.

For the face-enrollment transport demo, Compose wires the Backend's
`SMARTSITE_AI_IDENTITY_URL` to `http://ai:8000` and supplies a matching
service token. It accepts three authenticated JPEG uploads. Completion remains
honestly `AI_UNAVAILABLE` until a reviewed face model and private template store
exist; it never creates a simulated biometric profile or grants access.

### Account-linked face enrollment

The Access Control **Quyền vào cửa** tab replaces the Restricted Zones tab. Admin selects a site worker and the fixed Gate Desk catalog (Gate 1/2/3), then saves or revokes explicit gate permissions in PostgreSQL. Empty selection revokes all gates; saves are immediate with no expiry and require the last snapshot to prevent stale concurrent writes. Existing approved assignments with explicit gate IDs migrate with their original validity intervals. Site-wide/Zone assignments do not implicitly allow every gate. Gate checks still require an active linked account, active face profile and valid contractor participation. Restricted-zone APIs remain separate and unchanged.

Face Enrollment is account-first: search/select an existing active account for the current site,
then enroll its face. `POST /api/v1/sites/:siteId/workers/for-account` idempotently prepares the
internal worker linkage; it never creates a login account or grants entry permissions.
Gate-specific assignments use optional `gate_id` (null retains legacy site-wide behavior).
Only face scans resolved to a worker/account persist a decision in `gate_access_log` before acknowledging it.
Gate Desk first checks camera brightness locally, then polls an authenticated, non-persisting face-presence endpoint. Two stable observations trigger verification once; transient face continuity suppresses repeat scans until a different face appears or an observed empty frame persists for two seconds. Continuity is technical evidence, not identity or permission. The opt-in demo uses bounded AI RAM only (128 sessions, 30-second idle expiry); no presence JPEGs/embeddings are stored in DB/files. Camera selection/restart is available; covered/underlit cameras must be physically corrected. Clear explicitly starts a fresh test session. Real-camera continuity accuracy is not yet validated.
Unknown, low-confidence, poor-quality and unavailable scans without an identified account are not retained.
Authorized site gate operators can read the latest 50 records through
`GET /api/v1/sites/:siteId/gates/:gateId/access-logs`; Gate Desk shows these DB records,
including denied scans of identified people. These are software access decisions, not proof of physical passage.
Worker QR fallback is implemented in Site Access on the responsive Web portal. Inconclusive face
verification creates a five-minute fallback session. For unavailable hardware, the authorized gate
operator explicitly reports `CAMERA_UNAVAILABLE` and opens a session. The worker signs in, selects
the same site, enters the operator's session code in **QR của tôi**, and presents the generated QR.
The opening operator scans/confirms at the same gate and direction. Backend checks the account,
worker, face profile, contractor participation and current gate permissions; QR does not bypass a
denial. QR decisions persist as `method: QR`; manual clearance remains unimplemented.

Visitor registration is available at `/visits/register`, without a login. One representative registers
the site, group size, contact, host, requested area, gate and schedule. The request appears in
**Visitor Passes** for the Site Manager assigned to that site; only that scoped role may approve or
reject it. This is an in-app approval queue, without email/SMS delivery. A site without an active
Site Manager rejects registration. The representative saves the private tracking link returned after
submission, then opens it to see approval and the real QR pass. Tokens expire after five minutes,
refresh automatically while the pass page is open, are stored hashed and consumed on confirmation.
Refresh invalidates the previous unconsumed token. Security scans by camera, uploaded QR image or
scanner/manual token, then confirms actual headcount for each IN/OUT. Counts cannot exceed the
approved group size or people inside. Identical retries produce one event; departure remains possible
after the schedule ends while people are inside. Requested area is recorded with approval, not an
MF06 Zone grant or individual visitor identity. Keep the tracking link with the representative.

Apply migration `QrAccess1791417600000` before the updated Backend/Web. Browser QR scanning requires
camera permission and HTTPS or localhost. If the face camera is unavailable, use another scanning
device, an uploaded QR image or a scanner/manual token. Worker QR is available through Web on a
phone; it is not an Expo native QR screen.

Face templates now live as encrypted ciphertext in PostgreSQL `face_profile.encrypted_template`.
`worker.user_id` links an explicitly selected account to the worker; `face_profile.user_id` records
the account at enrollment. Raw photos are transient. The Fernet key stays in the AI runtime as
`SMARTSITE_AI_IDENTITY_TEMPLATE_ENCRYPTION_KEY`, never in the database or browser.

An Admin selects an active site-assigned account (or global Admin) in Face Enrollment.
The Backend reuses its linked worker or prepares an internal worker automatically.
The lower-level `PUT /api/v1/sites/:siteId/workers/:workerId/account` endpoint remains available
for explicitly linking an existing worker with `{ "userId": "<account UUID>" }`.
Each account may link to one worker per site. Changing an existing link to another account is rejected.
Then capture three samples with consent. The Backend atomically saves the encrypted template,
account, profile metadata, and completed session. A matching face resolves the worker and account;
gate permissions still depend on the Backend's contractor and assignment policy.

Each guided capture has an explicit 3-second countdown, a frozen photo preview and a server quality result.
Enrollment and Gate Desk support camera selection/restart, release stale or disconnected streams, and reject dark/blank feeds before upload. Camera readiness is only a usability guard; server-side face and target-angle checks remain authoritative.
The capture target is required: missing or invalid `target` is rejected rather than silently checked as front-facing. Older browser clients must refresh before enrollment. Completion failures preserve allowlisted quality reasons, including the failed pose and inconsistent samples; the UI does not claim a measured 15-degree yaw.
Only an accepted photo enables the next angle; failed checks explain lighting, sharpness, framing or
relative pose. The AI rechecks front/left/right and sample consistency before producing a template.
Quality/landmark thresholds are demo heuristics, not calibrated yaw measurements or liveness protection.

Deploy the Backend migration `AccountFaceTemplates1790899200000` and both updated services together.
Legacy file-backed active profiles become `NEEDS_REENROLL`; select their account and enroll again.
Old local template files are preserved and are no longer read. Disabled accounts, removed site roles,
inactive workers and revoked profiles are excluded from matching. Revocation clears DB ciphertext.
AI restarts retain enrollment because the templates come from PostgreSQL, but all AI instances must
use the same encryption key and compatible model. Losing/changing the key requires reenrollment.

### Mobile Development

See [apps/mobile/README.md](apps/mobile/README.md) for Expo development instructions.

CI currently verifies Android and iOS JavaScript exports. Emulator, simulator, and physical-device validation remain separate steps.

## Environment Configuration

Example environment files are provided where required.

The backend validates environment variables with Zod and defaults to local PostgreSQL for development. Only development loads `apps/backend/.env`; production and test ignore it. Set `NODE_ENV` in the process before importing the application. For hosted Neon environments:

- Runtime services use `DATABASE_URL` (pooled TLS connection).
- TypeORM migration CLI commands prefer `DIRECT_URL`, then `DATABASE_URL_UNPOOLED`, within the selected environment source. Process environment values take precedence over the local env file. Neon pooled URLs fail closed when no direct URL is available.
- For local Neon development, link the project and pull only its PostgreSQL variables into the Backend's gitignored `apps/backend/.env`; see [apps/backend/README.md](apps/backend/README.md).
- Deployed environments must supply the same variables through their secret manager.

Production configuration must provide explicit database, browser-origin and AI service-token settings. Secrets must not be committed to Git. The [Backend guide](apps/backend/README.md) documents logging, request IDs, error responses, rate limits and PowerShell/Linux commands.

## Development Commands

```sh
pnpm dev
pnpm dev:web
pnpm dev:api
pnpm dev:mobile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm check
```

Additional validation used before pull requests:

```sh
pnpm peers check
pnpm --filter @smartsite/mobile check:dependencies
```

## Testing and Quality Gates

Application CI currently verifies:

- frozen dependency installation;
- dependency peer checks;
- ESLint and TypeScript checks;
- automated tests;
- Web and Backend builds;
- React Native JavaScript exports;
- TypeORM configuration and database validation;
- Docker image builds;
- PostgreSQL readiness;
- application container smoke tests.

Backend integration tests use a separate PostgreSQL 18 service with ephemeral storage, never the development volume or Neon. To run them locally:

```sh
node -e "const fs=require('node:fs'); if (!fs.existsSync('apps/backend/.env.test')) fs.copyFileSync('apps/backend/.env.test.example','apps/backend/.env.test')"
docker compose -f infra/compose.yaml --profile test up -d postgres-test --wait --wait-timeout 60
pnpm --filter @smartsite/backend test:integration
docker compose -f infra/compose.yaml --profile test down
```

Only `TEST_DATABASE_URL` from the process or the explicit Backend `.env.test` is accepted, with local host and `smartsite_test` user/database. The test runner applies migrations once before sequential test files; concurrency within race tests is preserved. Unit/HTTP tests set `NODE_ENV=test` before imports and discard inherited runtime configuration. See the [Backend guide](apps/backend/README.md) for the complete quality and Compose readiness checks.

Architecture quality is enforced through module boundaries, authorization, validation, tests, auditability, and integration contracts rather than folder structure alone.

## API Documentation

Swagger is available only in development at `http://localhost:3000/api/docs`; it is disabled in test and production.

Shared client code lives in [packages/api-client](packages/api-client). Business contracts will be introduced alongside their corresponding domain modules.

## AI Integration

The intended safety flow is:

```text
Camera
  -> detection and tracking
  -> AI detection event
  -> NestJS Backend
  -> business validation and deduplication
  -> OpenAI supplementary evidence analysis
  -> authorized human verification
```

For restricted-zone monitoring, identity and authorization are separate concerns. A person may remain unidentified; Site/Zone permission is decided by the backend using business data.

## Project Status

**Current phase: runnable project foundation.**

Implemented:

- Web, Backend, and Mobile application foundations;
- TanStack Query integration;
- shared API client foundation;
- validated backend configuration;
- PostgreSQL connectivity and readiness checks;
- Docker-based local environment;
- CI pipelines and automated foundation tests;
- integration point for the separate AI service.
- canonical MF05/MF06 technical-observation contract and RFC 8785 hashing;
- TypeORM MF05/MF06 domain schema and reviewed migration;
- authenticated AI event ingestion with raw-event preservation, idempotency, context validation, and durable alert grouping.
- JWT access/rotating-refresh authentication, global Admin plus Site-scoped role assignments, Admin configuration APIs, and camera-scoped AI configuration reads.
- Site-scoped Admin/Safety Officer alert read and review APIs, including curated source-observation/evidence metadata without exposing raw AI payloads or storage URIs.
- authenticated exact-frame JPEG access through a bounded local development adapter; the Web contract remains storage-neutral for a later object-storage adapter.
- companion AI worker support for finite video, laptop camera, and RTSP sources through the locked YOLO11s detection, tracking, PPE, and restricted-zone pipeline.

Not yet implemented in this foundation:

- áp dụng role theo Site vào từng workflow nghiệp vụ (Auth/Users đã quản lý assignment; Shift/Schedule configuration now supports Site Manager Site scope) và scope Contractor/Zone;
- full workforce, attendance, and incident workflows;
- production Neon integration;
- production multi-camera operations and benchmark evidence;
- MF06 worker identity and Site/Zone permission resolution;
- production object evidence storage and retention;
- OpenAI API calls.

These capabilities are intentionally developed through dedicated feature pull requests after the foundation is merged.

## Documentation

Architecture decisions and technical baselines are maintained under [docs/architecture](docs/architecture).
The verified local YOLO11s-to-alert demonstration is documented in the
[MF05/MF06 end-to-end runbook](docs/operations/mf05-mf06-local-demo.md).

Per repository policy, generated task plans, execution specs, and working documentation are local-only artifacts and are not committed to Git.

Contribution conventions are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

## Academic Context

SmartSite is developed as a SEP490 capstone project. Public repository visibility supports collaboration and technical review; it does not imply production readiness or certification for real-world construction-site safety operations.
