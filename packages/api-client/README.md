# Shared API client

Shared by Vite Web and Expo Mobile. Source TypeScript is exported for their bundlers; `build` additionally checks and emits declarations. Backend does not depend on this package.

```ts
import { getBackendHealth } from '@smartsite/api-client';

const health = await getBackendHealth('http://localhost:3000', {
  signal: abortController.signal,
  timeoutMs: 8000,
});
```

The base URL excludes `/api/v1`. Health responses are validated at runtime. Errors expose `code` (`http`, `network`, `invalid-response`, `timeout`, `cancelled`) and HTTP status when relevant; server response bodies are not displayed to users.

`SmartSiteManagementClient` provides authenticated management endpoints. For MF05/MF06, `listSafetyAlerts(token, siteId, { offset, limit, status, type })` returns a page of safety alert summaries, and `getSafetyAlert(token, siteId, alertId)` returns one alert with linked detection summaries and curated evidence metadata. `getSafetyAlertEvidence(token, siteId, alertId, eventId, evidenceIndex)` returns the authorized JPEG as a `Blob`; clients create their own short-lived object URL and revoke it after use. The detail response includes `detectionsTotal`; the Backend returns at most the latest 100 detection summaries. The shared TypeScript response types live in `@smartsite/contracts`, so Web and Mobile do not need local copies. Clients must never construct or display AI storage URIs. No tokens or environment secrets belong in this package.

`pnpm --filter @smartsite/api-client test` exercises real HTTP responses including timeouts and malformed data with a local test server.

Session calls (`login`, `refresh`, `logout`, `me`) have a 10-second deadline covering response headers and JSON body parsing. The client rejects with `code: 'timeout'` and aborts the request even if a fetch adapter or parser ignores abort; an uncooperative adapter may continue its own underlying work. Calls are not automatically retried. Other JSON endpoints keep their existing timeout behavior; public method signatures are unchanged.

Evidence JPEG reads default to a 5-second deadline and use `cache: no-store` / `redirect: error`. They enforce the Backend's existing 1 MiB image limit, reject invalid declared lengths, and check JPEG start/end markers. A browser stream is stopped as soon as its actual bytes exceed the limit, including when Content-Length is missing or inaccurate; timeout/cancellation releases its reader. Native fetch adapters that expose only `blob()` enforce size after buffering. These transport checks do not prove the JPEG is fully decodable or that AI/Worker identity is correct; the Web handles display failures separately.
