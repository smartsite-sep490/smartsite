# Legacy Hook inventory and next experiment decision — 22 October 2026

The AI thread generated a TRAIN-only inventory before its turn failed with `Selected model is at capacity`. Root recovered its files, inspected the executable inventory and original source metadata, verified22 input pins and independently reconciled occurrence/count summaries. No successful final agent report or continuing agent work is assumed.

Evidence: `D:/Ky9-FPT/SmartSiteData/runs/unified15-reviewed-v12-training-20261022-v1/legacy-hook-inventory-v1/`; `inventory.json` SHA256 `879363ecce324c515b810bc76f7a318a7cde6df5750f3af747d2f3df8c8a751c`, `inventory.py`, `representative-source-extents.jpg`, `root-review-v1.json`.

## Findings that affect the next action

All1,579 remaining legacy Hook-positive photographs/2,512 targets come from `harness-v2-retained`. Their original archive occurrences are distinct. Filename families are not separate publishers, people or scenes: z_numeric793photos/1,215targets; hex_named617/1,049; full32/40; vn17/29. They cannot establish independent source groups or a clean subset.

Root viewed the12-photo contact sheet, not every full-resolution image. It includes field scenes and product/mannequin photographs. Several old boxes visibly span connector-plus-lanyard assemblies, while others are small/localized. This confirms a mixed-extent concern in the inspected examples; it does not prove all remaining labels wrong.

Box area alone is not a valid correction rule. The legacy median normalized area is0.013443; the13 coordinate-reviewed photos/29boxes have median0.027375. Large rectangles are not automatically wrong and small ones are not automatically metal-only. Inspected local source metadata declares class names/export identity but supplies no connector-versus-assembly extent guide. The3,541 canonical metadata versus3,542 export-README count discrepancy remains unresolved; no archive rehash was claimed by this inventory.

These legacy rows also contain2,640 Harness targets. Quarantining every photograph would discard that supervision. Source also has120 inherited class14-known rows with no Hook target; they are not reviewed hard negatives. Any expanded UNKNOWN policy must state its exact scope, remove unresolved class14 geometry along with its BCE mask and preserve other targets. No such expanded policy was applied here.

## Experiment choice remains gated

Do not repeat a classifier-only NO-Gloves run as if it were untried. The existing v9 handoff records an actual three-epoch row6-only experiment, preserved other weights and rejected its result: the strict NO-Gloves improvement control failed, while18 other controls remained unchanged. Its saved-output audit found51/58 references without any retained box at IoU>=0.5; post-threshold outputs do not prove absence of raw boxes. Corrected current TRAIN data differs from v9, but freezing box/features still cannot learn new localization geometry. A repeat needs a new testable reason.

The completed24-row localized transformation is mechanically valid, but still mostly inherits mixed-extent class14 supervision. A data-only ablation could measure those corrections; it cannot be presented as ontology cleanup or a promised route to19/19. A reviewed-only canonical class14 view would reduce positive coverage to13photos/29boxes and would require a separately stated masking/completeness policy; it is not authorized or materialized by this report.

Next useful work is explicit source/target alignment and independent field coverage, including annotation completeness and hard confounders. The old19 controls and VAL/test remain unchanged. New canonical benchmark annotations must be versioned separately, rather than rewriting old references to make a model pass. Coordinate approval does not by itself certify every unlabelled region as negative, rights/consent, wearer identity or model quality.

No labels/scopes/dataset/model/threshold/protocol were changed and no further training or inference ran for this inventory. Root owns the remaining work while the designated AI thread is unavailable.
