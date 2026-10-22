# Hook target transformation review — 22 October 2026

Root reviewed the pure in-memory helper and independently executed its 19 focused checks plus the pinned actual-approval exercise. This verifies target conversion software; these 19 tests are unrelated to the 19 model-retention conditions. V12 remains rejected, 6/19 retention conditions passed.

## Inputs and change boundary

The human-approved eleven-photo batch contains 25 class14 boxes. T12 has its separate two-box approval. The helper binds each decision to actual image bytes, original label bytes, absolute source paths, dimensions and available parent IDs. The caller first verifies the exact human receipt, packet and displayed-figure hashes. Boolean fields alone do not establish approval provenance.

Only approved class14 targets may be replaced. Explicitly unresolved TRAIN rows remove class14 geometry and disable its classification scope together; classification masking alone does not remove ordinary box/DFL supervision. Other class targets and scopes stay unchanged. VAL/test changes, wrong-image receipts, nonfinite/out-of-bounds coordinates and conflicting decisions are refused. Unchanged labels retain their original bytes, including line endings.

Helper: `D:/Ky9-FPT/SmartSiteData/runs/unified15-reviewed-v12-training-20261022-v1/target-transform-helper-v1/target_transform.py`, SHA256 `72e33e24fd967fa74342625c3cf64c29cf818eb882c51c7ad4c4e0419224bc8c`.

## Actual defect found and repaired

Root checked all 5,765 parent label hashes against the pinned V12 manifest. Strict label parsing refused none. Image hashes and filenames are unique, but 13 queueId values cover 19 extra occurrences with different images. Existing repair crops and development frames legitimately share source lineage identifiers.

The initial helper incorrectly treated queueId as globally unique and would reject those distinct rows. Two focused cases reproduced that refusal; the repaired helper uses image/path/label/file identity for uniqueness while checking queueId only as supplementary receipt equality. It retains both distinct images and still rejects swapped-image approval. No row was deleted or deduplicated to pass.

Evidence: `root-helper-compatibility-v1.json`, `target-transform-helper-v1/root-unit-review-v1.log`, and the AI thread's preserved failing cases. The parent diagnostic only parsed pinned labels and metadata; it was not a full image-byte transformation exercise.

## Independently executed scope

- 19 helper cases passed in 0.146 seconds, including exact unchanged VAL bytes, pixel roundtrip on nonsquare images, stale/pending/wrong-image decisions and real shared-queue parents.
- The actual receipt exercise supplied 16 parent rows: 12 approved replacements containing 27 new Hook boxes, V2-03 as UNKNOWN14 in memory, and three unchanged controls. All other-class targets/scopes stayed unchanged; input pins were rechecked after execution.
- Its total output Hook count is 29 because the unchanged controls retain two old Hook targets. The number of newly approved boxes remains 27, not 29.
- Root wrote a separate report `target-transform-helper-v1/root-actual-approved-dry-run-v1.json`; only the report destination was changed by its runner. The AI thread's original report remains preserved.

## Next gate and limitations

The AI thread has a bounded full-parent streamed rehearsal: preserve all 5,765 rows/order and all 659 VAL rows; replace exactly the twelve approved photos, mask/remove class14 only on the eleven previously unresolved review-v1 rows and V2-03; retain all other bytes/scopes. Verify image and label pins and report exact deltas before materialization. Other HOLD/unreviewed rows cannot silently become negatives or new canonical annotations.

No derived dataset was written, no trainer/model was loaded, and no training, model application, website or database change occurred in this review. Full-corpus transformation, experimental admission, independent PPE/wearer qualification and whole-product acceptance remain unproven. The localized repair does not certify the remaining legacy Hook inventory or remove its possible ontology conflicts.

## Full-parent follow-up

The AI thread executed the streamed full-parent rehearsal in 9.7 seconds: all 5,765 images and labels were checked before/after, preserving every occurrence and all 659 VAL rows. Root inspected its executable checks and independently recomputed all 5,765 label pins, occurrence-order hash, exact 24 changed-row identities and class-count deltas. Root did not repeat the complete image hashing. Evidence: `full-parent-rehearsal-v1/rehearsal-result.json` SHA256 `e573f3efed616434b2fb47c9ed0de7175f848a2821c57c4b16114b74ca70620c` and `full-parent-rehearsal-v1/root-review-v1.json`. Root's first checker failed on Windows default text decoding; the explicit UTF-8 version passed and both scripts remain preserved.

Twelve approved replacements change 14 old Hook targets into 27 (+13). Twelve explicit UNKNOWN14 rows remove 18 old Hook targets (-18). Net TRAIN Hook count is 2,546 to 2,541; classes0–13 and their positive-image counts remain unchanged, including 2,829 Harness targets. All 74 previously approved rows remain unchanged. Other 5,741 rows retain their original labels/scopes. No new corpus was materialized.

This leaves 1,579 legacy Hook-positive photos with 2,512 Hook boxes not certified against the connector-only definition. The thirteen coordinate-reviewed Hook photos contain 29 boxes, including the previously approved control photograph. The remaining legacy labels are not thereby proven wrong. This limited repair cannot be described as full ontology cleanup or a guaranteed route to 19/19 retention.

Root authorized only a bounded CPU mechanics check next: at most one small batch, two CPU threads, actual frozen scoped loss, approved/held/retained-class examples, no optimizer step, epoch, GPU, worker or full-corpus export. It must distinguish verified BCE/target exclusion from any unexecuted box/DFL claim. Independent data qualification and a justified training design remain open.
