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
rejected checkpoints remain rejected. No trainer, model load or deployment ran
for the quarantine operation above.

## Follow-up: two new public source CPU diagnostics

Root subsequently acquired and viewed original source images
091217-N-0807W-062 and060616-N-9712C-009. Publisher metadata and original bytes
are retained in `ai-industrial-controls-two-source-20261021-v1` under the evidence
root above. Agy's original cmd wrapper never started Python; Root verified and
stopped only that childless wrapper, then executed the bounded acquisition
directly:two images acquired, no failures. This was not a training submission.

Root then loaded the pinned experimental80b checkpoint for a CPU-only diagnostic:
two threads,832pixels, confidence0.25, IoU0.7,15-class map verified. Actual exit0.
Neither image produced Gloves or NO-Gloves detections. Root's original-pixel
proposals are visible bare hands in the first and work gloves in the second.
These observations expose development misses; they are not human ground truth,
wearer accuracy, capacity or independent qualification measurements.

Proof: `ai-two-source-cpu-diagnostic-20261021-v1/{protocol.json,result.json,root-quality-review-v1.json}`.
The sources have now been used for development; do not relabel them untouched
qualification holdouts. Exact SHA absence from parentv4 and the17-source proposal
does not prove whole-lineage/scene independence. Hidden-hand balance, reviewed
annotation boxes and the independent qualification protocol remain open.
No training, new weights, threshold change or product application performed.

### Annotation review follow-up

Root refused Agy's first proposal: all six boxes used vendor IDs instead of the
current fifteen-class map. Corrected proposal v2 uses Person0, Gloves5 and
NO-Gloves6. Root verified both original-image hashes, dimensions, all six raw
boxes unchanged and raw-to-normalized arithmetic; the mechanical check passes.
Proposal SHA256: `c13db879383d294a41fcf20532de17db773d2d7c445c65f92f1e3fe89234eb8e`.

Agy P8 independently reviewed both images and reported tool/rebar occlusion,
touching glove boundaries and incomplete whole-image labels. Root retained these
limitations but rejected overlap alone as proof of a bad box and ordinary
eyeglasses/military clothing as certified PPE. These remain development proposals,
not exhaustive fifteen-class labels, human GT or admitted training data.

Proofs in `ai-industrial-controls-two-source-20261021-v1`: Root's v1 refusal,
v2 mechanical verification, P8 annotation review and Root admission review.
No new train is justified by these two images alone.

### Two further scene controls acquired

Root acquired and viewed the original Korolyov suspended-scaffold and bamboo
scaffold-dismantling photos, preserving Commons metadata and attribution in
`ai-industrial-controls-next-source-20261021-v1`. Both downloads completed;
independent image/metadata hash and dimension checks passed. A preliminary inline
guard command had a quoting failure; the corrected three unsafe-URL checks pass.

The first scene has a visible light glove and other hands obscured by body,
equipment or structure. The second has small hand regions requiring closer
review. These add observed occlusion examples, not a qualified balanced cohort.
Publisher metadata declares CC BY-SA3.0; this is not a legal approval or human
GT. Source/admission review is retained separately. No labels, train or new model
inference ran on these two photos; neither is an untouched qualification holdout.

### Follow-up CPU localization diagnostic

The two scaffold photos were subsequently run once on the same pinned80b model,
CPU2,imgsz832,confidence0.25. Actual exit0;both return four Person proposals and
zero Gloves/NO-Gloves proposals. Oversized Person boxes cover facade/scaffolding;
the bamboo scene also has overlapping Vest/NO-Vest detections. These development
failures are not independent false-positive rates or final person policy results.

Root investigated five Person targets occupying at least85% of an image in the
actual corrective6 training manifest (6416 total occurrences),hash-checked labels
and viewed/verified all five candidate images. Each contains a large foreground
person;box area alone does not justify quarantine or relabeling. No causal link
to facade detections is established,no labels changed and no new train justified.

Proof:`ai-next-two-source-cpu-diagnostic-20261021-v1/result.json`,
`large-person-source-candidates.json`,`root-diagnostic-review-v1.json`.
This supersedes only the preceding no-inference statement for those two photos.

P8's subsequent full-label review found a separate concern:images186 and195 each
have two overlapping Person targets on one visible foreground person. Root read
both label files and confirmed the visible subjects. This refines the area-only
ruling;large box area is still plausible,but duplicate targets need technical
curation. Root chose no replacement coordinates or silent label changes. Future
quarantine must use a new immutable revision. No causal explanation for facade
detections or new training eligibility is established. See
`root-duplicate-person-review-v2.json` and P8's retained visual review.
