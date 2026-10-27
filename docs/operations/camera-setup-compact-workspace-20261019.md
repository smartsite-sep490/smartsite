# Camera setup: compact workspace and exact-camera Regions

The camera list is the primary setup workspace. Register and Zone PPE actions
live beside its heading; the three-step guide uses native details/summary and
starts closed. Active camera rows open Regions for that exact camera, with
metadata management kept as a secondary action. No new route/tab or library.

The requested camera ID passes through the existing scoped Zone dialog. Until
that camera is loaded, active and in the selected Site, no other camera is
silently selected and no Regions/reference request runs for an unrelated ID.
Appending metadata pages can resolve the requested camera. An operator can
explicitly choose another available camera. Existing role gates, source-image
requirements, geometry, revision/TTL checks, draft protection and paused guards
remain unchanged. Configuration enabled does not claim a camera source is online.

Actual Agy p5 supplied regression cases, reviewed the implementation, and aligned
four earlier test files with the new hierarchy. Root implemented the production
change after six failing tests and repaired the remaining selection reset and
native select placeholder failures. Root reviewed saved source and ran checks.

Evidence under
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1`:

- Focused exact-camera/hierarchy6FAIL before implementation, then6PASS.
- Affected33files: initial252PASS/10FAIL; final four aligned files18PASS plus244
  other cases from the earlier run =262 distinct cases, not one262-case run.
- Final precommit6files24PASS on the current source.
- Full Web TypeScript and changed-file lint/format exit0.
- Source/DOM evidence only: no browser-policy retry, screenshot, device or visual
  acceptance. Existing website remains frozen Backend61/Web bundle28 until a
  separately qualified compatible release is prepared.

The current branch includes Main585. This camera UI commit is separate from the
local Main integration checkpoint. No push, GitHub merge, database mutation,
capture, model or AI training was performed for this UI change.
