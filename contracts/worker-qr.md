# Worker QR fallback and manual code

Worker opens the QR action on mobile, chooses entry or exit, and immediately receives a QR plus the same **8-character code** below it (for example, `ABCD2345`). Worker does not enter a code from Security. When face recognition is unavailable or inconclusive, Security scans this QR or types the Worker's code in the gate fallback form.

The web Gate Desk has no separate manual identity-verification form or Worker profile selector. Security uses face verification or the Worker's QR/code, then confirms actual passage under the existing authorization rules.

## API examples

An authenticated Worker at the requested Site obtains their own code:

```http
POST /api/v1/sites/{siteId}/worker-qr
Content-Type: application/json

{"direction":"IN"}
```

```json
{ "token": "ABCD2345", "expiresAt": "2026-10-17T12:05:00.000Z", "direction": "IN" }
```

The QR encodes exactly `token`. Codes use the same unambiguous alphabet as Visitor booking codes, are generated with cryptographic randomness, and are stored as SHA-256 hashes. Unlike a Visitor booking code, a Worker code expires after five minutes, is single-use, and is replaced when refreshed. One displayed code corresponds to one QR, with the same server expiry. Mobile keeps this pair unchanged until the Worker explicitly refreshes the QR, changes passage direction, or opens a new QR. It does not rotate codes on a 60-second timer or when returning from the background. It hides the old pair during refresh/error and aborts pending requests when closed or the scope changes.

Security still opens an internal, five-minute gate fallback session when face verification fails. Its UUID is sent by the Security UI; Worker never needs to read or enter it:

```http
POST /api/v1/sites/{siteId}/gates/{gateId}/qr-verifications
Content-Type: application/json

{"token":"ABCD2345","direction":"IN","requestId":"00000000-0000-4000-8000-000000000001","fallbackSessionId":"00000000-0000-4000-8000-000000000002"}
```

Manual input accepts lowercase and outer whitespace, normalizing to uppercase. It does not accept a Worker ID as a code. Verification still requires the opening Security operator, exact Site, Gate and direction, an unexpired/unconsumed fallback, and an authorized Worker. Schedule, Contractor, Site assignment and current document checks remain authoritative. Eligible Workers may enter through every gate in their own Site without a gate grant; the QR fallback remains bound to its opening Gate session. Creating a code does not record attendance. Actual passage confirmation retains existing replay/idempotency checks.

The issue and verification endpoints each allow 20 requests per minute under the existing authenticated throttler. Refresh invalidates previously issued, unused Worker codes; the code on screen is the one Security must use.

## Compatibility and migration

Deploy migration `WorkerQrShortCodes1792454400000` before the Backend that issues independent Worker codes. It relaxes only the credential's subject constraint so a Worker can obtain a code before an officer session exists. Verification binds that credential to the actual officer session. No column, personal data or historical record is removed. Rollback refuses to restore the old constraint if independent Worker credential history still requires it.

Older clients can continue to issue using `{"fallbackSessionId":"<officer-session-UUID>"}` and verify legacy `SSQ-...` credentials. Exactly one of `direction` or legacy `fallbackSessionId` must be supplied when issuing. Shared client `issueWorkerQr(token, siteId, { direction })` supports the current flow and keeps the previous string argument for older callers.

For local setup, migrate using the Backend's documented migration command; no native Android build is required. PostgreSQL integration tests use the dedicated `smartsite_test` database, never the development database.
