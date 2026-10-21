# YOLO source curation: one classroom image quarantined

Status: prepared and verified experimental dataset; not admitted for training,
independent ground truth, model acceptance or website application.

## Observed problem and decision

Root viewed original image1122.jpg (1024x680), an indoor classroom scene with
ordinary eyewear/footwear. It cannot substantiate the industrial PPE positives
used by this experiment. Quarantine the whole TRAIN occurrence rather than
invent replacement negative boxes or assume an unletterbox correction.
Original image1024.jpeg (640x640) was also viewed; no additive glove box admitted.
Occlusion and incomplete vendor labels remain limitations.

The bounded two-image audit verified original/current image hashes, dimensions,
class remapping and Decimal-equivalent coordinates. Both converted label files
preserve the vendor coordinates. Direct versus square-letterbox projection is
reported as an alternative, not established annotation provenance.

## Immutable revision

Parent: `D:/Ky9-FPT/SmartSiteData/datasets/unified8-source-repair-experiment-20261009-v4`.
Parent manifest SHA256:
`6e1af9630ca06f9fe0e5271f69f6741f915807666b2c6a1836ed97d60af07b0d`.

New: `D:/Ky9-FPT/SmartSiteData/datasets/unified8-source-repair-experiment-20261021-v5`.
New manifest SHA256:
`21d100f4108a19bfba0a5afcce727dc05e470ba1fd059270b88386dfe55bc8da`.

- TRAIN occurrences:5211 to5210; VAL:659 unchanged; total:5869.
- Exactly one excluded file:86bb5dd9f2c5a779df4522cdea24b1b6.jpg.
- No added boxes, changed retained labels, scopes, splits or class names.
- Builder verified retained source hashes before linking. Root separately verified
  every retained row field except output path, image/label file identity and exact
  output inventories. It did not repeat a full byte rehash.
- Images and labels are hardlinks. Both revisions must remain immutable; future
  annotation changes require new copied label files, never editing a linked file.
- Thirteen parent queueId groups repeat across derived occurrences. They are not
  independent scenes. An initial verifier incorrectly assumed queueId uniqueness;
  its failure is preserved and the corrected check uses split+filename identities.

Historical repeat counts and earlier experiment authorization remain explicitly
historical. Current trainingEligible/currentExperimentAuth/humanGT/modelAccepted
are false. This one-image correction does not qualify a nominal new train run.

## Evidence and remaining gates

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1`.

- `root-two-image-curation-decision-20261021-v1.json`.
- `ai-native-two-image-coordinate-audit-20261021-v1/audit-results-root-v3.json`.
- `ai-classroom-quarantine-build-20261021-v1/root-build-v2.log` (exit0).
- `ai-classroom-quarantine-build-20261021-v1/root-independent-result-v2.json`.

Still required: reviewed balanced glove/bare/hidden-hand controls, independent
scene/ancestry qualification, justified frozen training protocol and lifecycle,
all-family retention, actual wearer/video/camera/Backend/Web evaluation. Prior
rejected checkpoints remain rejected. No trainer, model load or deployment ran.
