# Reviewed Safety UI local preview — 20 October 2026

The local preview now serves Web commit `72c9acb18f62400b40801126a25bcfc7b53647c2`.
It includes scoped camera/Zone navigation, setup dialog focus fixes, assessment
history improvements and the latest Safety surface styling. Styling alone is not
visual or whole-product acceptance.

## Actual runtime boundary

- Origin: `http://127.0.0.1:5181`.
- Owner receipt: `software-main66-owner-v11.json` in the integration evidence directory.
- Node PID: `50348`, birth `2026-10-20T13:06:06.5915060+07:00`.
- Deadline retained: `2026-10-20T12:37:43.326Z` (19:37 Vietnam time).
- Backend remains frozen `bd91985479eed6d213b69e2bd307af0991c7bdb0`, 66 migrations.
- The source's newer 70-migration graph and lease fix are not deployed to this preview.
- AI/capture/inference/configuration image workers remain absent. No model was loaded.
- Existing accounts, roles and configuration were preserved; private account files
  remain only in the local output. This document contains no credentials.

## Bounded verification

The old exact owner exited with native exit code 0. Fresh before/after-stop and
pre-login startup comparisons preserved all 92 tables and retained selections.
No restore, migration or data overwrite was executed. PostgreSQL owner `31748`
and the dedicated loopback port 5433 were retained; 5434 was not touched.

Four existing Live overview tests, Web typecheck, three-file lint/format and the
production Vite bundle passed. HTTP confirmed exact index/entry asset hashes,
login page 200, unauthenticated Sites 401, existing Manager login 200, authorized
metadata 200 and logout 204. Session writes from this observer are expected.

Evidence is under `agy-backend-ai-20261020-v1/ui-rollout-v3` within
`SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`:

- `stop-proof.json`, `qualification.json`, `retained-startup-proof.json`.
- `start-proof.json`, `exact-owner-proof.json`, `http-minimal-proof.json`.

## Remaining limits

The browser-policy restriction remains: no local browser workaround was used.
Public GitHub REA screenshots do not verify SmartSite rendering. Main entrypoint,
browser/visual/device acceptance, MF06 media/identity/authority integration and
independent model quality remain separate gates. The known Access-owned ExcelJS
chunk warning remains deferred to its owner.

The one-use activation script is historical, not a reusable restart command.
Its independent review identified tighter path casing, wait margin and immediate
spawn recording for a future lifecycle. This successful run's actual receipts
establish its outcome; they do not establish behavior for every failure path.
