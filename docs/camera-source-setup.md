# Experimental camera source connection workspace

The existing camera registration fields describe a camera; they do not establish
video transport. Enable `VITE_SMARTSITE_ENABLE_SOURCE_SETUP=true` to show the new
connection workspace for the selected registered camera.

Configure `SMARTSITE_AI_SOURCE_HOSTS` as a JSON array of operator-owned entries:
`{"id":"edge-demo","label":"Site AI computer","siteIds":["11111111-1111-4111-8111-111111111111"],"origin":"https://ai.example.invalid"}`.
The default is an empty list. Only HTTPS is accepted in production; HTTP loopback
is permitted for local development. The AI service token stays on the Backend.
Origins and tokens are never sent to the Web app.

`GET /api/v1/sites/:siteId/cameras/:cameraId/source-hosts` lists scoped host
capabilities. `POST` to the same path plus `/:hostId/probe` tests a source.
Only the assigned Site Manager can test; authorized camera readers can inspect
capabilities. Authentication is checked again after the upstream operation.
Requests and responses are bounded, redirects refused, and cancellation propagated.
The Web app uses the shared API client and shared source-setup DTOs.

The workspace separates a host webcam/USB device, an IP camera with RTSP and
separate credentials, an approved recorded video (REPLAY), and this browser's
camera. The latter is explicitly unavailable until media ingestion is implemented.
Changing draft, site, camera or session invalidates the prior test result.

A successful test shows a real image but does not save source changes or start
AI. Host capabilities advertise `applySupported=false`. Encrypted durable source
settings, generation-bound apply/rollback, reference-image invalidation and the
browser transport are unfinished. Do not use this feature flag as evidence of a
complete deployed camera onboarding flow. See companion AI `docs/source-control.md`.
