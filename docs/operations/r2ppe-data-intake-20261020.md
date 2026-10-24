# R2PPE research intake — 20 October 2026

This is a data-quality milestone, not an AI model or product release.

Root reviewed actual Agy P5/P7/P8 outputs and ran the new standard-library annotation inspector. The official 5.5MB archive matches publisher MD5 and recorded SHA256. Its10,034 image records/123,751 raw annotations partition exactly into train+test by annotation multiset and image dimensions.

The inspector found30 zero-dimension Eyewear_Absent boxes and1 negative-dimension Mask_Incomplete box (24train/7test). All26 filename groups occur in both splits. The author's public conversion script globally shuffles images, so the supplied split is not adopted as independent video/actor qualification.

The released categories distinguish prescription glasses, safety glasses and goggles. They do not supply Person/wearer identity. Clinical labels are not automatically mapped into construction compliance.

No image/video download, model load, training, inference, corpus admission, threshold or website change. Research-only license and unresolved actor/scene/pixel validity remain explicit.

Full proof: D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/ROOT-R2PPE-INTAKE-REVIEW-20261020-v1.md
Inputs/results: D:/Ky9-FPT/SmartSiteData/datasets/incoming/r2ppe-annotation-research-20261020-v1
Sources: https://zenodo.org/records/13851664 and https://github.com/yangwanzhao/R2PPE-DATASET/blob/main/script_data_v72coco.py

MF05 notifications, MF06 trusted identity/runtime, independent model qualification and browser/release acceptance remain open.

## Follow-up: six actual PNG samples viewed

The earlier no-image statement describes the annotation-only milestone. Root subsequently obtained6 publisherTRAIN images through bounded HTTP ranges (21,074,168 ZIP bytes, not the whole34GB archive), verified memberCRC/outputSHA/PNG dimensions and decoded all6. The server omitted ETag/Last-Modified: v1 refusal is preserved, v2 explicitly records weaker before/after source-metadata matching rather than whole-archive cryptographic attestation.

Root viewed both frame and anchor-context galleries. Exposed hand/blue glove examples are useful research leads. Safety/prescription/goggle categories remain separate; the MaskIncomplete anchor spans head/upper torso and is not automatically converted to a missing-mask label. Two eyewear samples share a source group. No independent accuracy, humanGT, corpus admission or model change.

Three stdlib boundary tests written by Agy and executed by Root passed: refuse full-file HTTP200, wrong byte range, and over-budget read before network. Actual IHDR/decoded dimensions and path confinement checked separately for all6 files. Full review: ROOT-R2PPE-SIX-SAMPLE-REVIEW-20261020-v1.md alongside the earlier evidence.
