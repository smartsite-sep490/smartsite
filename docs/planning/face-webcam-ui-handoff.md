# Face Webcam UI Handoff for Antigravity

This is a UI implementation brief. The Backend remains authoritative for every access decision; the UI never infers `ALLOWED` from a face match.

## Screens

1. **Security gate desk (Web):** Site and gate selector, webcam preview, one explicit “Scan face” button, technical/access result panel, QR fallback launcher, and manual-review actions. Do not continuously identify people from the camera.
2. **Representative-led Worker enrollment (Web):** consent acknowledgement/version, three guided JPEG captures, capture-quality feedback, submit/retry state, FaceProfile status, and revoke/re-enroll action. Mobile has no enrollment or face-management screen for either role. Worker accounts have no self-enrollment or face-management controls; the Worker only confirms consent within the supervised session on Web.
3. **Worker mobile QR:** short-lived QR shown only after the gate desk has indicated QR fallback; warn that it does not itself grant access.
4. **Visitor flow:** QR-only registration, approval, and check-in/out. Do not render webcam or face-capture components for visitors.

## Required state mapping

| Backend result                                                  | UI behavior                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `MATCHED` + `ALLOWED`                                           | Green result; enable the Security Officer to record IN/OUT.                                  |
| `MATCHED` + `DENIED`                                            | Red result with safe reason; no QR fallback.                                                 |
| `MATCHED` + `MANUAL_REVIEW`                                     | Neutral/manual-review state; no automatic access.                                            |
| `UNKNOWN`, `LOW_CONFIDENCE`, `QUALITY_FAILED`, `AI_UNAVAILABLE` | Neutral failure state; expose “Use QR fallback”, then require Security Officer confirmation. |
| Network/upload error                                            | Retry state; do not show any cached successful result.                                       |

## Backend endpoints now available for workforce setup

- `POST /sites/:siteId/contractors` — the assigned Site Manager creates or links a Contractor and its active participation. Legacy unscoped provisioning routes are denied.
- `POST /sites/:siteId/contractors/:contractorId/representative-accounts` — the assigned Site Manager creates a representative account and links it atomically.
- `POST /sites/:siteId/contractors/:contractorId/representatives` — the assigned Site Manager links an existing active representative in this Site.
- `POST /contractors/:contractorId/workers` — Contractor Representative creates a Worker at an active Contractor/Site participation.
- `POST /workers/:workerId/site-zone-assignment-requests` — Contractor Representative requests assignment.
- `POST /site-zone-assignment-requests/:requestId/safety-review` — Safety Officer reviews it.
- `POST /site-zone-assignment-requests/:requestId/site-manager-decision` — Site Manager approves or rejects it.

Use `SmartSiteManagementClient`; do not build ad-hoc fetch calls or client-side role decisions.

## Privacy and accessibility

- Keep captured blobs in component memory only; revoke object URLs when replacing/unmounting; never use localStorage/sessionStorage for frames or templates.
- Render no raw similarity score or embedding. Use Backend reason codes and human-safe messages only.
- Use labelled controls, keyboard-operable scan/retry actions, visible focus, and text plus color for results.
- Limit capture to one explicit frame per scan; compress/validate MIME and size client-side for UX, but let Backend enforce the security limits.
