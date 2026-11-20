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

A successful test shows a real image but does not save changes. Operator-configured
LIVE activation is a separate opt-in: prepare stops the known owner, Backend
renews its generation and retires the prior view, then commit starts the new source.
Settings are encrypted at the host. A fresh source image and explicit PPE/region
confirmation are required; failed transitions stay visible for reconciliation.
The current local composition supports this single owned webcam; the stock AI
control command remains test-only. Browser transport, replay activation, general
remote deployment, and physical RTSP validation are unfinished. MF06 notification
acceptance additionally requires a qualified authority release/current epoch.
