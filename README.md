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

| Area | Technology |
| --- | --- |
| Web | React, TypeScript, Vite, TanStack Query |
| Backend | NestJS, TypeScript |
| Mobile | React Native, Expo Router, TanStack Query |
| Database | PostgreSQL |
| Hosted database | Neon |
| Data access | TypeORM (PostgreSQL) |
| API | REST, OpenAPI |
| Monorepo | pnpm workspaces, Turborepo |
| Infrastructure | Docker, Docker Compose |
| CI | GitHub Actions |
| AI | Separate FastAPI service |

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

The current foundation intentionally contains infrastructure-level modules only. Business modules are introduced together with reviewed domain workflows rather than as empty placeholders.

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

Start PostgreSQL:

```sh
docker compose -f infra/compose.yaml up -d postgres
```

Start the development applications:

```sh
pnpm dev
```

Default development endpoints:

| Service | URL |
| --- | --- |
| Web | http://localhost:5173 |
| Backend liveness | http://localhost:3000/api/v1/health/live |
| Backend readiness | http://localhost:3000/api/v1/health/ready |
| Swagger UI | http://localhost:3000/api/docs |

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

The backend defaults to local PostgreSQL for development. A hosted Neon connection is supplied through `DATABASE_URL` at runtime.

Production configuration must provide explicit database and browser-origin settings. Secrets must not be committed to Git.

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

Architecture quality is enforced through module boundaries, authorization, validation, tests, auditability, and integration contracts rather than folder structure alone.

## API Documentation

Swagger is available in development at `http://localhost:3000/api/docs` and is disabled in production by default.

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

Not yet implemented in this foundation:

- authentication and authorization;
- SmartSite business-domain modules;
- production Neon integration;
- camera ingestion and model inference;
- MF05 PPE workflow;
- MF06 restricted-zone workflow;
- evidence storage;
- OpenAI API calls.

These capabilities are intentionally developed through dedicated feature pull requests after the foundation is merged.

## Documentation

Architecture decisions and technical baselines are maintained under [docs/architecture](docs/architecture).

Per repository policy, generated task plans, execution specs, and working documentation are local-only artifacts and are not committed to Git.

Contribution conventions are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

## Academic Context

SmartSite is developed as a SEP490 capstone project. Public repository visibility supports collaboration and technical review; it does not imply production readiness or certification for real-world construction-site safety operations.
