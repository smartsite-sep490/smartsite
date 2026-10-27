# LIVE demo — ingestion, assessment, notification, and current gaps

Current local: Flow42 / Node78076 (birth2026-10-22T17:58:49.3690250+07:00), existing PG69444/schema73. Backend baseline5e118c5 plus reviewed delta4449d04; Web36 retained. No push/merge/deploy or new training.

## Actual repaired path

Tapo's hash-bound v1.3 events initially received400: ingestion selected the legacy validator, rejecting schemaVersion and evidence.sha256.21 TERMINAL/HTTP_400 outbox records remain preserved. Ingestion now selects the existing v1.3 validator explicitly. Legacy dispatch, hash/geometry validation, canonical hash, role and persistence boundaries stay intact. One new regression case covers valid admission and three invalid variants;22 ingestion cases, scoped TypeScript and two-file lint passed. Initial compile/loader failures are retained.

Release guard correctly refused a copied runtime whose ingestion bytes differed. The derivative manifest records exactly one runtime delta and the corresponding source change; all161 authority-writer method review rows remain unchanged. Baseline manifest and failed starts remain retained. No old receipt was repointed to new bytes. Initial Windows long-path copy failures are preserved.

Existing local73 approval was used with the original authenticated WEB Admin and expected previous epoch to record the derivative release baseline. Old epoch57189f08-48c1-476a-848a-527f783bd12b is CLOSED and preserved; current3bcc99eb-f9cd-41ac-899a-176d04d1a330 is READY from2026-10-22T11:05:09.946Z, matching manifest36aa4dbdda7d84cb54c2c6a03a7e818ec3461fc2bb7d62faa2af81a9aeff3f03. The operator subprocess disables its own enqueue/worker; website processing stays enabled. First operator attempt refused because those flags were enabled in its subprocess; readback proved no commit before the corrected attempt. Own operator session logged out. No new role, policy or backdated authority was created.

- LIVE eventdc16cd55-9ee1-595f-9dc6-791b854eccc2: requestbb29dcb9-9635-4dff-8be7-ea67ce1f100f, assessment8a43afbf-7698-48e9-a043-3729e2576a25; job SUCCEEDED, ALLOWED/POLICY_NONE. Safety history and SHA-bound frame200. Earlier AUTHORITY_UNAVAILABLE assessments remain, never rewritten as successful decisions.
- LIVE PPE candidate: alerte28ea2d2-f33e-4fe0-a928-6f01cb344a2e, eventc01fe79c-1ded-5d07-96ff-1490847692b1, PPE_HARD_HAT_MISSING/PENDING_REVIEW. One notificationa445236f-0b23-473d-9e33-eb93203c4ce9 addressed to demo.safety; inbox200 and original JPEG200/byte-identical. This is not a human-confirmed violation or Worker identity.
- Operator reported walking through; Root viewed a real Tapo assessment JPEG. No assertion identifies the person or equates that image with a particular human action.

Proof root: D:/Ky9-FPT/SmartSiteData/runs/demo-ai-notification-20261022-v1. Key files: live-delivery-rejection-v1.json; live-delivery-admission-v2.json (old original event accepted202 but SKIPPED_CLOCK_SKEW, never retimed); live-v2-mf06-proof.json (earlier UNAVAILABLE); live-after-ready-mf06-proof.json; live-persisted-alert-notification-proof.json. Scope is local HTTP/DB/model execution, not browser acceptance or model qualification.

## Runtime / lifetime

Website output: website-flow42-20261022-175849-427d0d45 under main-0dd7d27-integration-20261017-v1. Website expiry2026-10-22T20:55:23.721Z. Four preview owners remain77656/74684/77492/75080; owner filefour-preview-lifecycle-owner-v5.json and watcher78928 now follow Node78076. All four preview wrappers have STOP/deadline drain; their original deadline02:41VN23/10 remains earlier than the website. Durable Tapo actual Python78212, wrapper78920; run-live-tapo-v2.py, new outbox-tapo-live-v2.sqlite3, status-v2 and STOP-LIVE-DURABLE-v2. Old worker73060 stopped normally before export; all old outbox/media preserved. First operational Start-Process argument-array attempts failed before camera startup and are retained separately. No duplicate replacement owner was started.

Fresh pre-stop export captured73 migrations and45 then-existing media files, matching latest DB snapshot. Website stopped normally and retained schema; PG and four previews stayed running. New LIVE files have since accumulated. Do not use45 as the current total.

## User-reported polygon and lag

Tapo PPE region2abbfd54-0c23-4cc1-b5c8-b306eb9a4d87 and restricted regionf6063983-f952-4c0d-b023-558e7482d0ea both currently store normalized full-frame polygon[(0,0),(1,0),(1,1),(0,1)], geometry1/configuration3. No geometry changed in this repair. User has been asked which smaller physical area is intended. Configure with demo.manager through /camera-setup, not the read-only monitoring page. A name saying restricted does not override POLICY_NONE or establish unauthorized identity.

Actual /zones uses useScopedCameraPreview, default1000ms polling, synchronized analyzed image/overlays. A short authenticated HTTP probe measured Tapo analyzed-frame age1066–1186ms; laptop1022–1102ms. Existing raw live endpoint over3.5s returned Tapo19frames (~5.4 delivered FPS, capture age69–252ms), laptop26 (~7.4,82–260ms). Request times35–64ms. These are observer I/O numbers, not rendered browser FPS or glass-to-glass latency.

Next bounded FE task: offer existing raw live canvas separately from analyzed evidence in /zones; never paint old AI boxes on fresh raw pixels. Reuse current auth/scope/TTL hook. Polygon save must propagate real versions to analysis and overlay; current preview region files are a fixed startup export, so do not claim arbitrary later edits already synchronize. Laptop durable delivery, cold source binding, actual browser geometry/layout, independent AI quality and identity/authority business acceptance remain open.
