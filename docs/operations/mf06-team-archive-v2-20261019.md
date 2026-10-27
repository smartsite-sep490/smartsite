# MF06 team-aware archive V2 boundary

Current follow-up: V2 team effects are now implemented in the private projector.
The initial boundary commit c885463 deliberately refused V2 projection; the
follow-up replaces that temporary gate with MAIN_ARCHIVED_ZONE_EFFECTS_V2.
Sixteen genuine RED projection cases now pass with42 V1 and13 V2 codec cases:
71 cases across four files. Full Backend TypeScript and changed-file lint pass.
No capture migration or current runtime adoption follows from this change.

The existing archive codec now recognizes explicit
`MF06_MAIN_AUTHORITY_ARCHIVE_V2` envelopes/payloads. V1's source registry, row
shapes, format and canonical hash behavior remain unchanged. Unknown versions
are rejected; the old unknown-version fixture now uses V3 because V2 exists.
An envelope cannot label a V2 payload as V1 or vice versa.

V2 adds TEAM, TEAM_MEMBERSHIP and TEAM_PERMISSION source masks and assignment
`zone_ids`. Row fields are strict, IDs/time values validated, membership and
permission intervals checked, and team/member/parent-permission Site/Contractor
relationships verified. Member Worker/Site must match; current Worker Contractor
is intentionally not an archive FK requirement because historical membership may
belong to a previous Contractor. Eligibility remains a projection concern.

All versions use the existing descriptor-based safe input materialization,
canonical hashing,2MB/2048-row/depth limits and deep freeze. No getters or
arbitrary JSON hooks execute. Returned identity and authority coverage remain
false. Source registry integrity is not complete writer/cutover attestation.

## Deliberate rollout boundary

The projector dispatches explicitly by archive version and returns the matching
effect projection version. V1 behavior stays unchanged; V2 additionally follows
the retained Main team UNION predicate. The assessment store still accepts only its
existing V1 format. Capture registry, PostgreSQL functions, migration graph,
current website and runtime registration are unchanged; no V2 is emitted there.
Do not add V2 metadata to an old captured epoch or overwrite historical receipts.

Next: plan Task3/4
adds coordinated forward capture/migration and actual PostgreSQL differential
proof. Task5 wires the trusted WorkPort only after coverage/media/identity gates.

## Verification

Evidence Q/team-archive-v2-v1, where Q is
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`.

- Genuine initial12 cases:11 failures/1 pass against V1-only implementation.
- First test fixture compilation had overly narrow inferred tuple types;
  corrected explicit source shape, failure retained.
- First expanded run missed the dynamic projector dependency in the sandbox
  compile and still used V2 as unknown version; both causes repaired, logs kept.
- Final55 cases across three codec/projection files pass, including13 new V2
  cases. Full Backend TypeScript and five changed-file ESLint/format pass.
- No camera/model/GPU/DB/cloud/browser execution or push/merge/deploy.

## Scoped size exception

Root reviewed growth of the existing approximately499-line archive codec to
approximately533 lines for version dispatch at its shared trust boundary.
New team schema/scope responsibility is extracted to `main-team-authority-archive.ts`.
Reusing bounded validation avoids copying security code into an independent V2
codec. Exception owner Root; reassess/extract common codec internals at the next
substantial archive change. Do not weaken limits or compress code to meet LOC.
New test file stays below400 lines. Independent Backend review remains open.

## Team projection checks

V2 covers membership joined/left at microsecond precision, active team and
Contractor/participation, matching scope, APPROVED assignment with Zone ID,
event-time assignment interval, and finite team permission within parent and
participation intervals. It does not require the team permission interval to be
contained in the assignment: retained Main only requires that assignment to be
active at the event. Both ALLOW and independent DENY effects remain visible to
the owning authorization policy, where DENY precedence belongs.

The shared synthetic V2 fixture was extracted to support both codec/projection
tests; its deny builder updates the V2 source copy. The old V1 fixtures remain
unchanged. Unit evidence is `projection-red.log` and `projection-final-tests.log`;
these are not actual PostgreSQL differential proof. That gate remains Task4.
