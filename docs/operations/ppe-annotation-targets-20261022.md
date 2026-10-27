# PPE annotation targets after V12

Status: Root-selected technical target for a future reviewed annotation lineage. No current label, class ID, API, threshold, frozen protocol or accepted model changes. This document does not approve individual boxes or license/consent. V12 stays rejected. Existing74 reviewed TRAIN photographs are not independent qualification truth.

## Stable detector and product boundaries

Keep the exact15 model names/IDs from `unified15-human-ppe-repair-20261022-v12/data.yaml` and `src/smartsite_ai/inference/ppe_profiles.py`: one Person class, eight positive equipment families and six explicit-negative classes. Existing Platform `contracts/src/ppe-items.ts` permits only HARD_HAT, SAFETY_VEST, GLOVES, BOOTS and GOGGLES for wearer observations. Mask/Harness/Hook remain raw detections; this work must not turn them into new wearer violations, notifications or safe-use assertions. A detection box never establishes Worker, Team, identity, authority or equipment certification.

For all classes: mark the visible object extent, one instance per box. Do not include unrelated person/background merely because attached gear is near them. Do not hallucinate occluded geometry. If sufficient visible extent/type cannot be resolved, HOLD/UNKNOWN rather than a guessed positive/negative. Full person or per-item coverage must be recorded explicitly; omitted labels never establish negative/background for an unsupervised family.

| ID/name (unchanged) | Future reviewed target | Confounder / UNKNOWN rule |
|---|---|---|
| 0 Person | Visible human instance, including partial views when recognizably human | No identity/team or unique-worker count from this class; occlusion is not absence |
| 1 Hardhat | Visibly industrial hardhat object | Bicycle/sports headgear not silently accepted as industrial hardhat; uncertain subtype UNKNOWN |
| 2 NO-Hardhat | Explicit visible head region without the defined hardhat under reviewed coverage | Hidden/cropped head or ambiguous headgear UNKNOWN |
| 3 Safety Vest | Visible high-visibility vest garment | Reflective tape, harness webbing or bright ordinary clothing alone does not establish the garment |
| 4 NO-Safety Vest | Reviewed visible torso without that garment | Covered/cropped torso or uncertain vest type UNKNOWN |
| 5 Gloves | Visible glove instance on a hand or clearly recognizable glove object | Hidden hands are not negative; glove object alone does not establish wearer association |
| 6 NO-Gloves | Explicit visible bare hand with reviewed boundaries | Skin-colored glove, blur or unresolved coverage UNKNOWN; do not box a torso instead |
| 7 Boots | Visibly boot-type footwear object | Camera appearance cannot establish toe protection/certification; ambiguous shoe/boot type UNKNOWN |
| 8 NO-Boots | Reviewed visible foot/footwear region explicitly outside the boot target | Cropped/hidden foot or unresolved shoe subtype UNKNOWN; no inference from a missing prediction |
| 9 Goggles | Clearly recognizable protective eyewear object, preserving legacy output name | Ordinary spectacles are not automatically protective; ambiguous design UNKNOWN; hanging eyewear may be an object but not worn evidence |
| 10 NO-Goggles | Reviewed sufficiently visible eye region without that protective eyewear | Low resolution, glare, occlusion or ambiguous spectacles UNKNOWN |
| 11 Mask | Visible face-mask object; no claim about respirator rating or correct fit | Face shield alone is not this object; ambiguous facial cover UNKNOWN; loose mask is not worn evidence |
| 12 NO-Mask | Reviewed visible nose/mouth region without that mask | Hidden face or unclear cover UNKNOWN; do not label a visibly masked face negative |
| 13 fullbody-Harness | Recognizable full-body harness equipment: connected harness structure, worn or loose, bounded to visible equipment | High-vis vest/reflective stripes/isolated ambiguous strap do not establish a harness; no secure fit/anchorage inference |
| 14 Lanyard-Hook | **Connector-only target: the visible metal safety snap-hook/compatible connector instance**, preserving the legacy detector name | A whole lanyard, worker torso, wheelbarrow handle, rope or large person-plus-gear assembly is not a connector box. Unclear hardware/type UNKNOWN; do not infer attachment or locked gate |

Hook target is selected to make new annotation extent consistent with the two human-reviewed metal-hook instances and the product's raw Hook object intent. It does not retroactively reinterpret every vendor `Lanyard-Hook` rectangle. Historical assembly-sized boxes remain original references, tagged `EXTENT_AMBIGUOUS`; no automatic shrink, delete, conversion or HUMAN_ACCEPTED flag is permitted. The exact connector subclasses still need concrete image review: a generic curved metal object is not sufficient.

## Why split Hook from lanyard/harness

OSHA defines a lanyard as a flexible line and a snaphook as a hook-shaped connector with a keeper; a body harness is a separate strap system. These distinctions support separate object extents rather than treating an entire worker-and-rope region as one metal hook. Source: [OSHA1926.500 definitions](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.500). This is nomenclature evidence, not a claim that SmartSite detects compliant fall protection or determines which jurisdictional rules apply.

Protective eyewear may incorporate prescription lenses or be worn over them; ordinary-looking spectacles cannot be classified solely by whether the wearer has a prescription. Source: [OSHA1926.102](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.102). Therefore uncertain eyewear stays UNKNOWN rather than inventing a visual certification test.

## Admission and benchmark rules

1. Build the discrepancy packet from original images, exact source boxes and saved V12 predictions: approved TRAIN hook photo, ambiguous VALf179e, median Hook TRAIN, three paired-regression examples and seen-development wheelbarrow frames0/30/75. Show original source role, source identity and geometry. This is diagnostic, not a new training export.
2. Review positive extent, instance grouping, confounders, visibility and complete admitted-family coverage per image. Preserve prior human decisions; any newly proposed grouping/extent gets a separate decision. Keep held/ambiguous source rows outside the canonical-admitted subset until resolved.
3. Keep VAL/test bytes unchanged. No reviewed diagnostic VAL case may be moved into TRAIN. Legacy19 control results remain immutable and are not weakened to accept V12. If canonical ontology cannot be evaluated against assembly-sized legacy rectangles, document the incompatibility and propose a separately frozen, independently reviewed benchmark/version; do not silently change the old score or call it equivalent.
4. All frames/crops from a development clip remain one development group. Before admitting class14 negatives, review that the entire admitted region lacks the defined connector; other families remain UNKNOWN. No blanket whole-frame negative from one wheelbarrow ROI.
5. Independent qualification requires whole-scene/person/video lineage, rights/source evidence, representative positives and negatives, and exhaustive admitted-family review. The existing five videos/30 frames have zero human-reviewed complete frames; TRAIN label approval is not this gate.
6. Only after these gates are concrete may a new bounded training proposal specify one mechanism, parameter/buffer policy, replay/retention and lifecycle checks. No new heavy experiment starts from this document alone. Current source/checkpoint/protocol artifacts remain frozen.
