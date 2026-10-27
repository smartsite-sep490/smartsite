# Duplicate Person targets: immutable data revision v6

## Actual change

Root viewed the full images and read their labels; Agy P8 independently reviewed
the same two images. Each contains one visible foreground person and two nested
Person targets. No replacement coordinates were guessed.

Starting from `unified8-source-repair-experiment-20261021-v5`, the new v6 excludes
only these TRAIN occurrences:

- `native-v4-retained::images/train/image186.jpg`
- `native-v4-retained::images/train/image195.jpg`

Actual output is 5867 occurrences: 5208 TRAIN and 659 VAL. All retained row fields
except output image paths are identical; every retained image and label has the
same file identity as its parent. Images and labels are immutable hardlinks.
Validation pixels, labels, scopes and membership are unchanged.

The builder verified all 5869 parent image/label hashes before creating output.
Three unsafe planning fixtures reject missing targets, changed label pins and
VAL targets. Root independently checked exact exclusions, inventories, metadata,
false acceptance flags and retained file identities. Agy P7 reviewed the builder;
its statement that hash checks prove filename uniqueness is too broad. Actual
uniqueness is established by Root's separate inventory/key assertions.

Manifest SHA256:
`4dc82e4bae083b3e0d0b9ba52164b6620295953fb0fbf14fbc152f335e08243e`

YAML SHA256:
`87d3d500b5655e0cfdb19815a8252df638af205697a78f9085962dfbee87081d`

## Evidence

Under the tooling run's `main-0dd7d27-integration-20261017-v1/`:
`ai-next-two-source-cpu-diagnostic-20261021-v1/` contains the builder, verifier,
`duplicate-quarantine-v6-root-proof.json`, P8's exact exclusion review and P7's
bounded builder review. Source revisions and previous failures remain intact.

## Limits and next gate

A separate pinned-label audit found 96 high-overlap Person candidates: 93 TRAIN,
3 VAL. These are review candidates, not 96 proven annotation errors. Only the
two visually supported cases were excluded. The rotated single-target derivative
`image557.jpg` remains; occurrences are not independent scenes.

This technical quarantine adds no labels, human GT or accepted corpus. It does
not prove the cause of facade Person detections or justify a new training run by
itself. Data/protocol and independent retention gates remain open; no model was
loaded, trained or applied by this revision. Website and DB were unchanged.
