# Eleven-photo connector TRAIN annotation decision — 22 October 2026

The human answered **“Duyệt 11 ảnh, 25 khung Hook”** after Root displayed three review sheets. The question limited approval to the shown Hook/carabiner annotations for experimental TRAIN use, kept V2-03 on HOLD, and excluded VAL/test changes and model acceptance.

## Exact approved scope

| Case | Approved class14 boxes |
| --- | ---: |
| V2-02 | 1 |
| V2-07 | 1 |
| V2-09 | 1 |
| V2-13 | 1 |
| V2-15 | 1 |
| V2-17 | 3 |
| V2-19 | 3 |
| V2-20 | 5 |
| V2-22 | 3 |
| V2-23 | 3 |
| V2-24 | 3 |
| **Total** | **25** |

Receipt: `D:/Ky9-FPT/SmartSiteData/runs/unified15-reviewed-v12-training-20261022-v1/train-connector-review-v2/root-human-batch-v1/human-approval-v1.json`, SHA256 `865eeb487a11c9fe0b64aec4418dae37648c42085c6c45ddfbaf22038fab0db9`.

The receipt embeds each original image/label identity and hash, dimensions and pixel coordinates, plus the exact review-batch and three displayed-figure hashes. Review-batch SHA256 is `eb6258f55f9a4c96be4b441b26d9c1f34a33de938fa08df4da64220ba9b95060`; parent candidate packet SHA256 is `e59394b1158bdb5370c8b24b51228a9cfd3e1fde1f1b7fdcd605efaa8a96b3fe`.

Root independently verified 24 byte-identical original copies, 48 image/label pins, exclusion of previously approved/reviewed image hashes, coordinate bounds and old approval receipts. Root viewed all 12 initially proposed full originals, five HOLD originals and all three overlay sheets. The separate AI thread viewed all 24 originals; Root does not claim those other seven full-image views. The final approval readback checked all 22 approved image/label pins, case coordinates and three displayed figures against the exact receipt.

## Why V2-03 is excluded

The original third proposal spans a lower dark carabiner and an occluding absorber sleeve. Root and the AI thread inspected an exact source crop `[230,440,370,580]`, including a nearest-neighbor enlargement. The visible upper/interface extent remained uncertain, so the entire image remains HOLD for full class14 inventory. This does not establish a wrong label or an absent connector; a bounding rectangle containing occluder pixels alone is not proof of an annotation error. Do not silently include its three original proposals in the human-approved set.

## Limits and next implementation

- These are existing TRAIN product/equipment photographs, not independent field footage or wearer-association evidence. V2-13/V2-15 appear related product variants; exact-file uniqueness does not establish scene or person diversity.
- Approval covers the listed class14 boxes only. It does not approve other classes, other images, source license/consent, a model, a new training run or whole-product acceptance. T12's separate one-image/two-box decision remains unchanged.
- The original candidate manifest retains its historical pending/machine-proposal state. Join the new human receipt explicitly; do not rewrite old source labels or approval timestamps.
- Before any derived dataset, review the pure target-transformation helper: bind exact image/label hashes, replace only approved class14 targets, preserve class0–13 targets/scopes and VAL/test bytes, and remove unresolved class14 geometry targets when masking that channel UNKNOWN. Positive targets outside a disabled scope remain forbidden by the frozen trainer.
- No dataset, model or website was changed by this review. The AI thread is preparing the transformation helper and focused checks; Root must review it before any controlled materialization or training decision. V12 remains rejected, and 19/19 retention would still not prove independent accuracy.
