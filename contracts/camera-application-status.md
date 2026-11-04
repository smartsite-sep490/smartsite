# Desired versus reported Camera configuration — C03

`GET /sites/:siteId/cameras/:cameraId/application-status` uses existing management
read roles (global Admin, same-Site Manager/Safety Officer), rejects query overrides
and returns no-store. It does not issue a bundle or refresh a receipt.

The response contains Camera/Site IDs, desiredRevision, reportedRevision|null,
applicationState, observedAt, lastReceiptAt|null, viewValidity and reasonCode|null.
The canonical browser-safe parser is exported from
`@smartsite/contracts/camera-application-status`. The shared client binds returned
scope and bounds both success/error JSON to4096bytes, with default3000ms timeout,
no-store, redirect-error and cancellation through the existing bounded transport.

Backend derives the response in one repeatable-read snapshot with server database
time and a fixed60000ms receipt freshness budget. A browser cannot choose that
budget. Missing generation/receipt is UNCONFIRMED. A newer saved desired revision
is PENDING. Expired/revoked generation, old receipt or unavailable view is STALE.
Only a fresh receipt matching the current generation and issued bundle/view/hash
reports LOADED or REJECTED. Replaying an ACK preserves its original receivedAt,
so retries never renew freshness. Replacing a generation cannot inherit its
predecessor's receipt. Future-dated receipt metadata is hidden and reports STALE.

LOADED describes a reported configuration installation, not camera online state,
pixels, model quality, physical pose, identity or business authorization. A manual
Region confirmation does not turn viewValidity into physical pose verification.
Missing issued configuration requires revalidation; damaged issuance fails closed.
No secret/hash/worker credential is returned. There is no new migration or role.

Actual producer atomic apply/ACK, supervisor renewal, trusted event ingestion,
live monitoring performance and FE presentation remain separate acceptance gates.
