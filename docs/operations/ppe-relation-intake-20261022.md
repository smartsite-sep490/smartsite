# PPE relation intake — 22 October 2026

## Actual result

Human approved the eight C04/C10 positive coordinates with the exact answer
“8 khung khoanh đúng” to question `call_7d0a3684139a4f4596250bb52e05d04b`.
Receipt SHA256: `7d14c7e51f4984cc7bf07b8ce4b45ee83bdab8c7aeb7840a1b0ba5914740b755`.
Source/figure pins were rechecked before saving it. Historical proposal status
is retained; approval covers display-coordinate rectangles only, not wearing,
complete labels, negatives, source consent, TRAIN, qualification or model.

AI local commit `2c0dfae1eca63408df1bb298f4104cf2db17bfb4` implements a
versioned offline DRAFT intake, with exact source/EXIF/receipt/object binding.
Each object in the five existing wearer families requires an explicit relation
row; unassigned objects remain unresolved. Raw Mask/Harness/Hook are preserved
without wearer claims. Legacy schemas, runtime and external events are untouched.
Only three new files were committed; preexisting AI dirty changes remain separate.
Upstream AI Main was fetched as `bc4e0c88c9d9920453e1ebfc301a806ec8ca7dc7`;
this does not claim the existing branch fully integrates that Main.

Four actual reserved photos C01/C02/C04/C10 were converted to drafts: eighteen
coordinate-approved boxes, eleven unresolved wearer relation rows, zero wearing
approvals. Exact source/receipt binding and unchanged input hashes were checked
after readback and again against final code. C10 remains EXIF6 display coordinates.

## Verification and review

- Missing intake RED, then initial nineteen checks passed.
- Missing receipt binding RED; malformed receipt shapes three RED; boolean
  coercion and conflicting EXIF provenance four RED, all repaired.
- Final affected run: **129 PASS / four files**, including 27 new intake cases
  and existing legacy video-review/wearer-v2 tests. Scoped Ruff format/check pass.
- Independent AI review identified receipt binding, malformed input and EXIF
  issues; Root reproduced and corrected them. Full service/GPU tests not rerun.
- Receipt hashing verifies trusted local bytes, not authenticity of a human
  author. Parsing alone checks structure; real binding uses both verifiers.

Evidence roots:
`D:/Ky9-FPT/SmartSiteData/runs/reserved-ppe-positive-review-20261022-v1`
and `D:/Ky9-FPT/SmartSiteData/runs/reserved-ppe-relation-drafts-20261022-v1`.
All failed runs and intermediate artifacts are preserved.

## Remaining product work

Independent visual review of seven source photos confirms C02/C05 as proposed
worn-versus-hanging eyewear contrasts. They are not a controlled same-scene pair;
using them for calibration consumes untouched held-out status. Loose Boots C10
does not establish worn Boots, and separated people C08 do not test overlapping
ownership. No temporal video evidence follows from still photographs.

Next: prepare reviewable actual Person/body-part/relation annotations and obtain
their separate review, fill worn Boots/non-worn/occlusion/crowd coverage, then
freeze calibration and qualification protocol. No arbitrary anatomical threshold,
extra model, training run, inference, website restart or runtime activation occurred.
V12 remains rejected. Browser, wearer, model and whole-flow acceptance remain open.
