# Independent PPE source intake — 22 October 2026

No dataset or model is admitted by this work. Existing TRAIN/VAL/test, the19 learning controls, thresholds and model/runtime configuration remain unchanged. Root continues C1 of the reviewed YOLO/camera plan; current model rejection is not overturned.

## Existing Construction-PPE cannot be treated as a new independent source

The [official dataset](https://docs.ultralytics.com/datasets/detect/construction-ppe/) has1,416 images and11 classes. Its original labels include five positive PPE families and four explicit missing-item categories; `none` is not a new safety signal. It lacks Mask/Harness/Hook and a dedicated missing-vest category. The local official-source audit and native-v4 preparation bind the same archive SHA256 `bef8dcb599aa4e9d9f5e602cb6fa7143d3c84d7f6a0ff40463d7f2a4c2632ccc`.

Root compared all original files with V12, baseline80b corrective data, declared crop ancestors and608 already scored development records. Source2,832 image/label files were pinned/rechecked. These are original vendor splits, not the later project split names:

| Original split | Images | Exact known development exposure | Additional unexposed strict-parser HOLD | No exact match and parser passed |
| --- | ---: | ---: | ---: | ---: |
| train | 1132 | 858 | 65 | 209 |
| val | 143 | 105 | 10 | 28 |
| test | 141 | 86 | 14 | 41 |

Parser HOLD does not establish a human annotation error: finite/class/boundary rules were strict and no clipping or tolerance change occurred. Passing those rules is not semantic completeness. The old source split names and byte uniqueness do not prove independence from current warm-start/development history.

## Similarity and visual follow-up

The69 val/test candidates were compared with6,336 reference images using the existing EXIF-corrected RGB and horizontal/vertical dHash128 helper. Its fingerprint function was AST-identical to the pinned cache implementation;5,877 cache entries were reused and528 images newly decoded. All13,990 checked image paths were verified/rechecked. Of437,184 comparisons,39 pairs covered26 candidates; no exact decoded-pixel pair occurred. These are retrieval leads, not automatic leakage judgments.

Root viewed six source-only pairs, including four linked to actual training/scored references. The backgrounds/frames support conservative shared-scene proposals. Root also viewed all43 retrieval misses in three contact sheets:23 share the rooftop-setting proposal, two the courtyard-setting proposal, three an indoor setting referenced only to vendor train, five a candidate-internal fence setting and ten remain other/unresolved. The latter groups are not all proven actual model exposure. No-match is demonstrably insufficient as an independence test; no person identity, geolocation or exhaustive labels were inferred.

Evidence under `D:/Ky9-FPT/SmartSiteData/runs/`: `official-ppe-holdout-audit-20261022-v1/result.json`, `official-ppe-near-holdout-audit-20261022-v2/result.json`, and v1's `root-visual-review-v1.json`, pair sheet and three remaining-image sheets. Executed scripts in tooling: `audit_official_ppe_holdout_20261022_v1.py`, `audit_official_ppe_near_holdout_20261022_v1.py`, corrected `_v2.py`, `review_official_ppe_near_pairs_20261022_v1.py`, `review_official_ppe_remaining_20261022_v1.py`. V1 checked representative image paths before fingerprinting but duplicate aliases only at the end; its counter overstated the precheck scope. V2 explicitly checked all aliases before/after. Root confirmed candidate records identical, so the previous visual review still applies; both versions are preserved. No model was loaded or run.

## Additional primary-source screening

- [CPPE-5 author repository](https://github.com/Rishit-dagli/CPPE-Dataset) describes medical Gloves/Goggles/Mask plus Coverall/Face_Shield. Its author-maintained [dataset card](https://huggingface.co/datasets/rishitdagli/cppe-5/blob/main/README.md) marks dataset licensing unknown and describes Flickr/Google origins. The repository's Apache code license is not treated as blanket image permission. Its original class IDs and Hugging Face zero-based IDs differ. No archive, package or weights were acquired; this is not a construction-domain or eight-family solution.
- [Atharion's dataset](https://github.com/atharion-team/ppe-dataset-v1) declares three classes and mostly Construction-PPE upstream images. Its documentation is useful but it is not assumed to be new independent data. Its class-ID repair and leakage claims were not independently verified here.
- CHVG's article page returned403 and the API was unavailable to the web tool. The Buildings paper returned429. Neither is recorded as an inspected/downloaded corpus; no alternate surface was used. Published study results do not qualify SmartSite's model.

## Two reserved industrial photographs

The bounded intake selected three Commons originals before any model use. Two succeeded, totaling7,295,689 bytes. SourceC03 returned429; failure remains and was not retried.

| ID | Original source | Recorded author/license | Candidate visible objects; not approved annotations |
| --- | --- | --- | --- |
| C01 | [Cologne industrial PPE01](https://commons.wikimedia.org/wiki/File:Cologne_Germany_Industrial-work-with-Personal-Protective-Equipment-01.jpg) | Photo by CEphoto, Uwe Aranas; CC BY-SA3.0;14April2010 | Partial Person, helmet, red harness, visible connector; other lifting hardware requires type review |
| C02 | [Cologne industrial PPE02](https://commons.wikimedia.org/wiki/File:Cologne_Germany_Industrial-work-with-Personal-Protective-Equipment-02.jpg) | Photo by CEphoto, Uwe Aranas; CC BY-SA3.0;15April2010 | Person, helmet, gloves, protective-looking eyewear and mask; lower-body coverage UNKNOWN |

API size and original SHA1 matched downloaded bytes; local SHA256/metadata hashes and full attribution/license declarations were saved. Originals are unmodified. Root viewed both, with tool display resizing explicitly recorded. C01/C02 are conservatively one proposed source group, not two independent site/person units. Copyright declarations do not prove individual consent, equipment certification or Worker identity.

Both have no exact known-exposure role and no near match within radius8 against6,062 available known reference images. One additional declared-ancestor hash has no image path; generic pretrained exposure and full scene independence remain UNKNOWN. This is a retrieval check, not qualification. Neither photo has complete approved annotations, inferred negatives, TRAIN admission or model predictions.

Evidence: `ppe-field-candidates-20261022-v1/intake.json`, `ATTRIBUTION.md`, original C01/C02, `known-exposure-audit-v1.json`, `root-visual-review-v1.json`; acquisition uses the existing bounded public-fetch helper. No website/customer-data publication occurred.

Next: prepare explicit annotation/completeness/visibility review for reserved field candidates and acquire enough separate source groups to meet C1 coverage. Freeze per-capability evaluation limits and independent grouping before candidate qualification. These two photographs do not close the eight-family, wearer, temporal or installed-camera gates; no new training follows automatically.

Browser inventory now exposes the in-app browser again, but that alone does not prove the previous localhost URL restriction changed. Root read inventory/documentation only, did not retry the denied URL, and asked the human whether actual local access settings changed. Browser/UI acceptance remains open.

## Positive-box review follow-up

Root prepared and viewed two proposal sheets and native-coordinate crops. V2 corrected Person extents: C01 excludes the foreground beam; C02 includes the visible clothing strip at the lower-right image edge. All ten proposals passed source/figure hash and coordinate round-trip checks. V1 remains preserved.

The human then answered **“10 khung khoanh đúng”** for exactly the displayed V2 packet: C01 Person/Hardhat/Harness/Hook and C02 Person/Hardhat/two Gloves/Goggles/Mask. Immutable receipt: `ppe-field-candidates-20261022-v1/annotation-review-v2/human-positive-box-approval-v1.json`, SHA256 `5e775f86ae0f812efe2bc6e8a6cfe9122a3d0fd2d9cac855b1e2f120f3414a34`. It binds both source hashes, ten pixel rectangles and both displayed figure hashes.

This approves visible positive coordinates for continued reserved qualification preparation. It does not approve exhaustive annotations, negatives, source consent, independent scene coverage, TRAIN use or the model. The two images remain one proposed source group and zero admitted qualification cases; no predictions were run. Next review must establish visibility/completeness and additional source groups before an independent evaluation can make quality claims.
