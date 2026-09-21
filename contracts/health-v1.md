# Health contract v1

This contract is implemented for developer connectivity checks only. It does not replace the pending authenticated Backend–AI event contract described in README.

## Backend

- `GET /api/v1/health/live`: HTTP 200, JSON `{"status":"ok","service":"smartsite-backend"}`. Process liveness only; no database/model readiness assertion.
- `GET /api/v1/health/ready`: HTTP 200 if database check succeeds, HTTP 503 otherwise. No connection string or internal database errors in response.
- Development API docs: `/api/docs`. No authentication-protected domain API exists in this foundation.

## AI service

- `GET /health/live`: process liveness.
- `GET /health/ready`: API service readiness; no implied detector or identity readiness.
- `GET /v1/capabilities`: explicit configuration/implementation state. Detection, identity and OpenAI analysis remain unimplemented in this milestone.

Web/Mobile use the shared health client with finite timeout and cancellation. Business identity, authorization, event schema and idempotency are separate upcoming contracts; health is not permission to submit or read observations.
