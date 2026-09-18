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

This is the initial health-only client. Add generated clients from Backend OpenAPI when business endpoints are implemented; do not hand-copy business DTOs across apps. No tokens or environment secrets belong in this package.

`pnpm --filter @smartsite/api-client test` exercises real HTTP responses including timeouts and malformed data with a local test server.
