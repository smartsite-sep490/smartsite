# Camera configuration status

`GET /api/v1/sites/:siteId/cameras/:cameraId/application-status` is a user-authenticated,
Site-scoped metadata read. Existing Site configuration read permissions apply;
AI service tokens cannot use this route. It accepts no query parameters and
returns `Cache-Control: no-store`. It never issues a bundle, starts a camera or
changes configuration.

The browser-safe contract is `contracts/src/camera-application-status.ts`.
`desiredRevision` is the saved camera counter; `reportedRevision` is a receipt
from this camera's selected worker generation, or null. `observedAt` and
`lastReceiptAt` use database time. No generation credential is returned.

| State       | Meaning                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| UNCONFIRMED | No worker generation or application receipt exists. Saving or fetching configuration alone cannot confirm application. |
| PENDING     | Current configuration has not been issued with valid geometry, or the receipt is for an older desired version.         |
| LOADED      | A fresh current-generation receipt claims the exact issued version, captured view and hash were loaded.                |
| REJECTED    | A fresh receipt for the exact current issuance reports rejection; `reasonCode` explains it.                            |
| STALE       | Camera, generation, captured view, receipt context or receipt age cannot support a current application claim.          |

The receipt age limit is 60 seconds, measured from its original server receipt
time. Idempotent retries do not renew it. This is **receipt freshness**, not a
camera-online heartbeat. A running worker may still have an old application
receipt. A future receipt after database clock rollback is hidden and the result
is STALE; cached LOADED must not survive an unavailable/failed refresh.

Application and physical pose are separate. `viewValidity: UNCONFIRMED` remains
possible with LOADED and must remain visible as such. LOADED does not establish
physical calibration, model accuracy, smooth video or product acceptance.

The reader uses one repeatable-read transaction and the same validated immutable
bundle reader as the worker delivery endpoint. Invalid persisted issuance returns
a safe unavailable error. Receipts are selected by configuration version and then
database receipt order, within the selected generation only.

Camera Setup displays this metadata for the selected camera only. Its compact
summary shows saved/reported versions, application state, a separate physical-view
warning and manual refresh. A collapsed Details section contains timestamps,
reason and the stream/model limitation. Refresh pending/errors, changed scope or
changed saved revision hide the previous claim. A monotonic local timer consumes
the remaining 60-second receipt window and rechecks on focus/visibility; no image
or preview request is made by this component. A 401 uses existing scoped sign-out.
These UI checks are DOM/state evidence, not browser rendering or camera acceptance.
