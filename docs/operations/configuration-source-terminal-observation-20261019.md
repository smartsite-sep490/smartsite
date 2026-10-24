# Configuration source terminal observation — 19 October 2026

## Change and bounded execution

AI repository local commit `63960dab331acbab0571371054a89c3c3d43fd64` adds
allowlisted terminal trigger and pre-cleanup capture state/reason to the
model-free configuration host. It does not add reconnect or change detector,
model, frame identity, ownership, cancellation or native release policy.
Regression evidence: initial 5 failures/24 passes; final 86 passes across five
affected files; changed-file Ruff lint and format passed. The formatter's initial
blank-line failure was repaired. Other dirty AI files were preserved.

An explicit 30-second Tapo observation used a fresh output, the same authorized
physical resource/credential binding, a new ephemeral loopback port, and the
reviewed two-file source delta. Preflight verified exact existing webcam/website
owners, no other Python processes, the old Tapo owner/port absent, the old native
release receipt, and the remaining 16 source pins unchanged. No existing source
or website was stopped/restarted or rebound; no DB/cloud writes or model work.

Actual result: 58 observer responses (54 HTTP200 with exact frame identity and
JPEG hash, four HTTP503), then exit0. Terminal receipt reports
`terminationReason=deadline_elapsed`, `captureStateBeforeStop=RUNNING`,
`captureReasonBeforeStop=null`, `nativeReleaseProved=true`. Afterward the new
port60714 had no listener and only the original two webcam Python processes
remained. Node31276/birth11:36:32.2822760+07:00 still owned5181.

This did not reproduce the historical early termination. The prior decoder
message alone does not prove a cause. This short sample does not prove sustained
camera reliability, browser rendering, throughput, latency or hardware identity.
The current website still points to its old stopped Tapo binding; the diagnostic
source is stopped and was never applied to the website.

## Evidence and guard state

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`

- `terminal-reason-checkpoint-v1.json` and red/green test logs.
- `Observe-Tapo-Terminal-Reason-v1.ps1`: bounded execution with ownership/pin asserts.
- `tapo-terminal-observation-20261019-114627-8936e590/proof.json`.

The current on-disk CLI/runtime differ from the original running webcam's source
receipt. Existing source guards must refuse that drift: do not overwrite their
historical pins or claim the old full guard currently passes. A future source
rollout needs a new qualification and fresh lifecycle/DB snapshot checks before
any website restart. The active website's loaded Web/Backend remain ed9dd85 /
bd91985; no browser or whole-product acceptance follows from this observation.

## Next product gates

MF06 still lacks a trusted production WorkPort/runtime orchestration. Private
Main66/Tuán graph70 qualification remains unmerged/unapplied. Model acceptance,
wearer/identity/authority proof, MF08 notification ownership, browser/UAT and
deployment/capacity gates remain open. Goal ACTIVE; no push/merge/deploy.
