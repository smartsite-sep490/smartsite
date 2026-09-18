# SmartSite foundation

Approved through the user's request to begin implementation of the agreed stack. This milestone provides runnable app shells and development infrastructure, not completed MF05/MF06 business flows.

## Boundaries

- `apps/web`: React, TypeScript, Vite, TanStack Query; a simple development landing screen checks backend health. No invented incident data or auth bypass.
- `apps/backend`: NestJS modular API; `/api/v1/health/live` checks process, `/api/v1/health/ready` checks database; OpenAPI generated from actual controllers. PostgreSQL connection compatible with Neon; local PostgreSQL for reproducible development. No production database provisioning or migration execution.
- `apps/mobile`: Expo/React Native with Expo Router and TanStack Query; same live API health check, configurable LAN API URL. Native build requires local Android tools or later EAS setup.
- `packages/api-client`: shared typed health client consumed by Web and Mobile, with timeout/error handling and runtime validation. No duplicated server data in Redux.
- `smartsite-ai`: separate FastAPI service with health endpoint and explicit capabilities showing camera/PPE/identity/OpenAI not yet configured. Optional YOLO/Supervision dependencies and documented RTX4060 setup; no automatic weight downloads or paid API calls.
- `infra`: Docker Compose for backend/web/local Postgres, optional sibling AI repo profile; independently built images.

## Quality and scope

Node 24 LTS, stable compatible package versions, exact lockfiles. TypeScript version must satisfy tooling peer dependencies; mobile versions follow Expo's bundled matrix. Python 3.12 with uv lock. Secrets remain outside Git. Bind local published ports to loopback. CI runs lint, typecheck, tests and builds/export. Meaningful tests cover health failures, configuration and client errors; app shells verified by build and browser where available.

Repository modules grow with real use cases; do not add empty domains, generic base repositories or pretend authentication is implemented. Public endpoints in this milestone expose health only. Deployment is not production-ready until auth, storage, observability and complete business flows are implemented and tested.

## Acceptance

Fresh dependency installation from lockfiles succeeds; checks pass. Backend can start without Neon credentials and reports database readiness honestly. Web fetches its health. Mobile exports and passes Expo dependency checks; report emulator/device status accurately. FastAPI starts without CUDA or an OpenAI key. Compose config/build/smoke checks are attempted and limitations stated. Documentation includes exact startup commands and verified versions. Keep all branches after merge; open reviewable PRs, do not merge automatically.

Implementation resolution: Nest12 uses ESM. Node24.19.0 and TypeScript6.0.3 are compatible with installed lint/Expo tooling. Prisma schema has no invented domain entities, pg supplies real readiness checks. Container and JS bundle checks are complete; device/GPU/cloud integration remains outside foundation acceptance.
