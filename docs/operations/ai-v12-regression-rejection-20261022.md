# V12 completed training, rejected model

V12 finished three ordered finite CSV epochs with exit0. Root independently compared recipe, best and last checkpoint SHA with the exit receipt. Best SHA: `623ed712ebbe4ab24b38e587a93a7f518e2054385b3e09f5b09d18faf4d0c119`.

The AI thread completed608 source-reference image comparisons and76 seen-development frames, excluding13 inherited geometry refusals. Root read the result/control files, verified their linkage to the trained checkpoint, verified the frozen protocol SHA `0dbc3b3a9c6a02d79c815f8d9b46e3597da0c4adc636f0e1f67cdc98e0e670ae`, and independently recomputed all19 pass/fail booleans from saved counts without repeating inference or matching. Only6/19 pass; the candidate is rejected and not applied.

Examples of the tradeoff: native NO-Gloves matches7→8 and unmatched24→12; Mask matches3→5 with unmatched0→0; native Gloves matches54→55 but unmatched24→34; Harness matches561→565/unmatched168→163; Hook matches213→206/unmatched171→179. Unmatched source-reference predictions are not established false positives, and these development/selection-used references are not independent humanGT or production accuracy.

Root viewed video frames000/030/075, raw native image1 and raw harnessf179e. The three viewed frames still contain large Hook predictions covering the wheelbarrow and broad overlapping Person predictions. This is bounded example inspection, not a new full annotation, wearer association or unique-person count. Root made no new labels, threshold changes, inference runs or training jobs.

Authoritative evidence: `D:/Ky9-FPT/SmartSiteData/runs/unified15-reviewed-v12-training-20261022-v1/root-model-rejection-v1.json` and evaluation sibling `unified15-reviewed-v12-evaluation-20261022-v1/{result.json,learning-control-result.json,review.html}`. Original outputs/failures remain. The AI thread owns saved-record error analysis and a concrete source-ontology/coverage/independent-video proposal; no blind heavier training or softened gates. Product Node12916/Backend73 stays unchanged with worker/inference/model Apply off. The model/video acceptance gate remains open despite completed training.
