# Demo local MF05/MF06 — 22 October

Current website: http://127.0.0.1:5181. Flow41/Node73780, PostgreSQL69444, existing schema73. Web36, Backend5e118c5. Local isolated test environment; no cloud/deployment change. Browser rendering has not been verified by the agent.

## Demo sequence

1. Reload and sign in again if the previous session expires after the Backend configuration change. Existing accounts/passwords remain. Use demo.manager for Site Manager configuration and demo.safety for Safety Officer alerts/inbox. Private credentials stay outside Git in SmartSiteData/runs/demo-ai-notification-20261022-v1/DEMO.private.md.
2. Open `/ppe`, choose the demo site and four-source grid. Laptop webcam and Tapo are LIVE; VIDEO-CORE5 and VIDEO-HAT-VEST are REPLAY. Enlarge a camera with the existing focus/fullscreen controls. Four authenticated Backend previews returned current JPEGs; do not present replay as four physical cameras.
3. Sign in as demo.safety and use the notification bell or `/incidents` to inspect PPE alerts. Latest hash-bound replay examples: missing vest975a29a5-e719-4040-ad3b-dbd75048b925; missing hardhat e99dd67f-924b-4e70-8358-1de0ead44c8b. Both are PENDING_REVIEW. Open the selected detection's original image. These are real model-generated candidates from controlled replay runs, not human-confirmed violations or unique-worker counts.
4. Open `/zones`, choose VIDEO-HAT-VEST, and inspect MF06 recorded assessments. The latest replay produced9 automatic requests/jobs, all SUCCEEDED. All9 returned ALLOWED/POLICY_NONE under existing Zone policies. One SHA-bound assessment frame was retrieved and matched the stored JPEG exactly. This does not demonstrate restricted access, Face identity, team membership or unauthorized Worker detection.
5. `/camera-setup` remains separate. Existing Site/Camera/Zone/Region IDs, policies and selections were retained. Use the Site Manager account for configuration; Admin/Safety Officer are not automatically granted configuration authority.

## Running processing and boundaries

- Preview processes serve four sources. The Hat/Vest replay moved from CPU to GPU after real CPU timestamp lag caused Backend503; no freshness extension or frame re-timing was used. Other expanded previews use80b; the baseline Hat/Vest model stays scoped to its existing replay camera.
- A separate durable Tapo LIVE worker is actually processing frames at target2FPS with fallback80b, local outbox, original evidence JPEG and automatic MF06 enqueue enabled. At17:19VN120 frames were observed. Its future qualifying events can persist and notify through the normal guards; no new LIVE violation or LIVE notification is claimed yet. Laptop currently has preview, not its own durable delivery worker.
- Three finite baseline replay runs exercised the data path: initial PPE persistence; MF06 worker activation exposing missing hash binding; then corrected hash-bound integration. Repeated replay observations are not additional real people/incidents. Preserve old events/photos and failed proof attempts.
- AI fix7b99080346def0610c8bb6d1957a69eb199c65f4 binds SHA256 to exact immutable JPEG bytes, emits1.2/1.3 from the headless publisher, and leaves legacy publisher defaults unchanged.77 hash/evidence/domain cases plus21 runtime cases and scoped lint passed. Backend restrictions were preserved.
- Face identity is not configured. Model quality remains unaccepted. No new training, threshold change, business-policy change, push, merge or deploy occurred.

## Evidence and lifetime

Run root: SmartSiteData/runs/demo-ai-notification-20261022-v1. Current proofs: four-web-previews-proof-final.json; persisted-alert-notification-hash-proof.json; mf06-hash-proof.json; live-durable-status.json. Private source configs, tokens, original camera images and receipts remain outside Git.

Preview lifetime is bounded by the original source deadline02:41VN23 October; the website receipt has its own later expiry. Do not promise availability after expiry/reboot. STOP-ALL-PREVIEWS requests owner-checked preview cleanup; three sources drain via STOP files, while the old core replay has a forced-stop fallback. STOP-LIVE-DURABLE requests normal supervised worker cancellation/drain. Do not delete the shared evidence root or database schema. Current source-owner watcher uses actual listener child PIDs, exact births and string-preserved timestamps; the earlier timestamp-parsing watcher failure is retained.

Production gates remain open: actual browser/UI acceptance, supported live input coverage, independent model/wearer evaluation, identity/authority provenance, resource/soak/capacity, deployment and whole-product acceptance.
