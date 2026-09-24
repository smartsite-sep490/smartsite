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

The AI API is then available at http://localhost:8000.

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
- Admin/Worker login, revocable sessions, Admin configuration APIs, and camera-scoped AI configuration reads.

Not yet implemented in this foundation:

- role và data-scope chi tiết theo Site/Contractor/Zone (hiện mới có Admin toàn hệ thống và Worker tự quản lý tài khoản);
- full workforce, attendance, and incident workflows;
- production Neon integration;
- camera ingestion and model inference;
- camera-side MF05 PPE inference and end-to-end operator workflow;
- camera-side MF06 restricted-zone inference and permission workflow;
- evidence storage;
- OpenAI API calls.

These capabilities are intentionally developed through dedicated feature pull requests after the foundation is merged.

## Documentation

Architecture decisions and technical baselines are maintained under [docs/architecture](docs/architecture).

Per repository policy, generated task plans, execution specs, and working documentation are local-only artifacts and are not committed to Git.

Contribution conventions are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

## Academic Context

SmartSite is developed as a SEP490 capstone project. Public repository visibility supports collaboration and technical review; it does not imply production readiness or certification for real-world construction-site safety operations.
