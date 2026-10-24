# MF06 history technical references, 18 October 2026

Historical assessment rows keep outcome, reason, purpose, evaluator version,
timestamps, Camera/Zone context, disclaimer and the detail action visible.
Assessment ID and provenance move into a native, initially closed
`details`/`summary` section: Technical references / Thông tin kỹ thuật.
Machine values and existing API calls remain unchanged.

The references component resets on Site/API/client/credential/token scope
changes using the existing opaque scope nonces. It does not include raw tokens
in React keys. Changing language updates labels without closing the section.
Authorization errors still remove the scoped records.

## Implementation and review

Agy Herdr p8 supplied bounded public-document research and three rendered
regression cases. Agy p5 implemented the extracted component and paired labels,
then repaired strict test-fixture types. Root reviewed the actual diff and ran
verification. P8 independently reviewed production source; its optional live
locale-switch coverage observation was subsequently covered in the final test.
REA was not used. Research was not browser or accessibility acceptance.

## Recorded verification

- Meaningful missing-disclosure RED preserved before implementation.
- Affected suite: 139 PASS across 11 files after the production hook repair.
- Final changed test: 3 PASS after strict fixture repairs and live locale-switch
  coverage. These three overlap the 139; they are not 142 distinct cases.
- Strict TypeScript for the changed component/test dependency graph: exit 0.
  The initial whole-Web source/test check exhausted its 512 MiB heap, exit 134.
  A later bounded check of all Root Web src TS/TSX and tests passed at heap768 MiB
  in14.12 seconds, peak RSS881.5 MiB, BelowNormal priority; the40-second/1024-MiB
  guard did not fire. Vite configuration types passed in a separate command.
  Existing approved dependency mapping remains; native frozen CI is not claimed.
- Changed production files and final test lint: exit 0; formatting/diff checked.
- Production Vite bundle v26: exit 0 with AI work paused.
- Initial JavaScript closure: 473196 bytes, within the 500000-byte limit.
  Whole bundle budget remains FAILED: unchanged Access ExcelJS chunk is 929569
  bytes. The owner requested an Access handoff, not a waiver or rewrite.

Detailed logs, worker reports and final SHA256 pins are in the existing
`demo-readiness-20261014-v1/agy-usability-dispatch-20261018-v1` evidence directory.
Build and budget artifacts are in its sibling Main0dd integration directory.
Loader-path and catalog-audit harness failures are preserved alongside results.

## Release boundary

This is scoped source/unit/build evidence. The running website still serves the
previous frozen release. No runtime restart, database migration, model/camera
worker, push, merge or deployment belongs to this change. Real-browser rendering,
keyboard/assistive-technology checks, native CI and product acceptance remain
open. Do not retry the denied local browser action through another surface.
