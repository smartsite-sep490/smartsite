# T12 connector annotation decision — 22 October 2026

## Exact human decision

Root showed the original 600×600 TRAIN image and the coordinate-only review figure with two blue boxes. The human replied **“Duyệt hai khung Hook của T12”** to the question explicitly limited to two Hook boxes for experimental TRAIN use, excluding model acceptance and VAL/test edits.

The separate receipt is `D:/Ky9-FPT/SmartSiteData/runs/unified15-reviewed-v12-training-20261022-v1/train-target-review-v1/root-review-v1/human-t12-hook-approval-v1.json`, SHA256 `326b1f72db53f8b10ea59ef69b46e58b735ebfdb640ff32099704727ae8401a7`.

| Bound item | Exact value |
| --- | --- |
| Case / source role | T12 / original TRAIN photo |
| Original image SHA256 | `806eb3d5217cac79c49f866ab7ba1d99e46b5a26b5162a5d72ed72862114ebcb` |
| Original label SHA256 | `d1d5a4ab0d6f47d78169ec286795ade9320574a0b8665acb1bed655b32680bf0` |
| Review packet manifest SHA256 | `e5b8692983e09b5f68c5df90bfe6c6597f68fea1cd44cdf3a81d9f6cb0e7cfee` |
| Displayed figure SHA256 | `fbcc5347379b5bb046cd6903871bce97a4398ba583c18dd0c01a261d6260d56f` |
| Class / target | 14 / visible metal connectors, excluding the flexible lanyard and red absorber |
| Pixel xyxy boxes | `[132,13,234,98]`, `[99,169,296,301]` |

Root independently rechecked the image, original label, packet, figure, dimensions and exact proposal coordinates before recording the approval. Earlier Root readback verified all 18 copied TRAIN originals and 36 image/label pins, viewed three contact sheets and the T12 original. It did not exhaustively annotate all 18 images.

## What this decision allows

One image and two positive class14 boxes may enter a separately versioned experimental candidate, subject to its remaining coverage, provenance and lifecycle gates. The frozen source labels and old packet remain unchanged; the receipt is joined explicitly by identity and hashes. Do not rewrite old pending fields to make them appear approved at the time they were created.

The decision does not approve other images/classes, independent qualification, source licensing, consent, wearer association, a new training run, model quality or production use. One corrected example does not establish the prevalence of assembly-sized Hook supervision or predict 19/19 retention.

## UNKNOWN supervision must cover geometry as well as classification

Root read the actual frozen `unified8_experiment_train_v2.py`, SHA256 `a4c593a29ce3e8d98aaef0ae98a40e9cb70cd57d0f87a0afac80bc75adf94e6a`:

- `attach_scope` rejects positive classes outside declared scope before assignment.
- `ScopedBCE` rejects positive targets in a disabled class channel.
- Only classification BCE is masked; box/DFL remain ordinary upstream losses.

Therefore an unresolved old class14 rectangle cannot simply remain a positive geometry target while class14 is marked UNKNOWN. A future candidate must explicitly quarantine that row, or omit the unresolved class14 target from the derived target view while masking class14 classification and preserving other reviewed targets/scopes. Never remove the frozen guard or silently keep wrong geometry under an UNKNOWN label. Source originals and lineage must remain intact either way.

The separate Codex AI thread received this constraint and the exact receipt. It owns preparation of the reviewed target transformation and actual counts. Existing VAL/test/control bytes, the 19 acceptance predicates and rejected V12 checkpoint remain frozen. No dataset export, label mutation, inference, training or product runtime action occurred in Root's review.
