# Health contract v1

This contract describes connectivity checks. Authenticated Backend–AI observation ingestion has a separate canonical contract; health never grants permission to submit or read observations.

## Backend

- `GET /api/v1/health/live`: HTTP 200, JSON `{"status":"ok","service":"smartsite-backend"}`. Process liveness only; no database/model readiness assertion.
- `GET /api/v1/health/ready`: HTTP 200, JSON `{"status":"ok","service":"smartsite-backend","database":"up"}` if the bounded database check succeeds. HTTP 503 otherwise, using the public error envelope below. No connection string or internal database errors appear in the response.
- Both health routes are exempt from the in-memory rate limiter. This is process/database readiness, not detector, identity or authorization readiness.
- Development API docs: `/api/docs`; UI and schema are disabled in test and production. Service-token-protected AI ingestion exists; end-user authentication and its domain APIs are still pending.

### Backend HTTP errors and request correlation

Backend error responses use `success: false`, `statusCode`, `code` (for example `BAD_REQUEST`, `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`), `message` (string or validation-message array), `requestId`, `timestamp` (UTC RFC 3339), and `path` (without query string). Unexpected errors use a generic message; SQL, credentials and stack traces are never public. Only explicitly allowed details are retained, including AI validation `issues` and the readiness fields shown here:

```json
{
  "success": false,
  "statusCode": 503,
  "code": "SERVICE_UNAVAILABLE",
  "message": "Service Unavailable",
  "requestId": "health-probe-1",
  "timestamp": "2026-09-21T00:00:00.000Z",
  "path": "/api/v1/health/ready",
  "status": "error",
  "service": "smartsite-backend",
  "database": "down"
}
```

Success bodies retain their existing shape. Clients must tolerate the additional error-envelope fields while continuing to read readiness `status`, `service` and `database`; this HTTP change does not change the canonical AI event schema or hashing.

Every Backend response carries `X-Request-Id`, reused in logs and error bodies. A client ID is accepted only when exactly one header matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; a missing, malformed or duplicate header is replaced with a server UUID. Configured CORS origins may send and read this header, without credentialed CORS. Logs omit request bodies, query strings, headers and sensitive error details.

Ordinary HTTP and AI ingestion use separate per-instance quotas (defaults 120 and 600 requests per 60 seconds). Exceeding a quota returns HTTP 429 with `Retry-After`; these are initial limits, not measured throughput or a shared multi-instance quota.

## AI service

- `GET /health/live`: process liveness.
- `GET /health/ready`: API service readiness; no implied detector or identity readiness.
- `GET /v1/capabilities`: explicit configuration/implementation state. Detection, identity and OpenAI analysis remain unimplemented in this milestone.

Web/Mobile use the shared health client with finite timeout and cancellation. Business identity and authorization remain separate concerns from health and the existing observation event/idempotency contract.
