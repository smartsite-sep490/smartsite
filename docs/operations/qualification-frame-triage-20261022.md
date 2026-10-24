# Candidate video frame triage — 22 October 2026

## Decision

The five-source, 30-frame packet is intact, but it is **not an accepted eight-family PPE benchmark**. Root viewed all five contact sheets, covering every fixed sampled frame. This is technical visual triage, not human ground truth, exhaustive object annotation, or model qualification.

The V12 model remains rejected against its unchanged protocol: 6 of 19 gates passed. Nothing in this review authorizes applying V12, changing thresholds, rewriting legacy validation labels, or restarting training.

## Evidence reviewed

Packet: `D:/Ky9-FPT/SmartSiteData/runs/unified15-reviewed-v12-training-20261022-v1/qualification-frame-review-v1`.

Root independently verified the manifest digest, all 53 supplied source pins, all 30 copied image hashes and dimensions, HTML digest, five whole-video groups, and fixed sampling order. The check also requires the packet to retain UNKNOWN/unreviewed coverage and false acceptance/export flags.

Manifest SHA256: `2adfaa0883c888404dd736f8e9cf548318d094aa48236dda0b7df4117dcd4798`.

Root verifier: `../review_frame_packet_root_v1.py` relative to the packet. It imports Pillow only; no model, inference, camera capture, new video decoding, or download occurred. Integrity receipt and the five labeled contact sheets are in `root-contact-sheets-v1/`.

The eight supplied guard tests were inspected, not rerun by Root. They cover known training/selection use, development-clip substitution, whole-video grouping, frozen frame identities/order, and unsupported coverage/rights claims. These are preparation guards, not accuracy tests.

## Actual sampled content

| Source | Contact-sheet observation | Consequence |
| --- | --- | --- |
| V01 | Six views of the same short construction task; bare hands/head and tall footwear are visible at thumbnail scale. | A useful candidate scene; no exhaustive labels, protective-footwear certification, or independent-worker claim. It cannot establish all positive PPE families. |
| V02 | Two black images; drawings, one composite transition, and one interview image. | Preserve the samples as provenance. Do not present them as six real construction-camera PPE scenes. |
| V03 | Blank/dark endpoints, three vehicle/machinery views, and one interview view with reflective straps. | The sampled frames do not establish helmet, gloves, protective eyewear, harness or connector coverage. Reflective straps alone do not establish a safety vest label. |
| F01 | Two black images and four interview views with equipment in the background. | A title about respirator research does not prove a sampled person is wearing a respirator. Background equipment requires separate object review. |
| F02 | Dark initial image, two interview views, two visible respirator-wearing views, and an end-title image. | Two promising Mask-review frames, insufficient for broad PPE qualification or fit/compliance certification. Ordinary spectacles are not automatically Goggles. |

These observations do not certify a class absent from any original image. Contact sheets are reduced views; fine object extents require full-resolution annotation review.

## Next work

The existing Codex AI thread was assigned a bounded research task: at most three primary public sources covering the remaining PPE families, with original license/attribution, visible examples, and compatibility with `ppe-annotation-targets-20261022.md`. It must inspect existing sources first, avoid duplicate bulk downloads, retain unknown ancestry/consent limits, and make no training or benchmark export.

Keep these 30 original images and their sample indices unchanged. Any future benchmark is a separately versioned, reviewed artifact; a new source list is not ground truth. Do not filter samples based on V12 predictions or use this packet to lower the frozen acceptance gates.

## Browser verification remains open

The human reiterated permission to open Chrome. On this turn, the documented CUA inventory returned no browsers and the exact error `Local browser use is disabled in Work settings`. This is tool configuration, not missing human authorization and not proof that a page is broken. No local URL was retried and no alternate browser/protocol workaround was used. Actual PPE/Zone layout verification remains pending until browser access is enabled.

No website runtime, database, account, model, threshold, existing label, or product worker was changed in this review.
