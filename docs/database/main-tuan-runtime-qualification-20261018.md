# Combined Backend runtime qualification, 18 October 2026

This extends the combined66 qualification without updating a branch, the running
website, production or cloud. The immutable local review carrier is
`02e9b564e7124984163e359d514a7b861326f71e`, tree
`052f25d28e9aa84d33306e38463c7caae1397fd6`.
It retains the same production bytes as the previous `af3eac7a` candidate.

## Corrected test contract

The inherited enrollment test still expected Worker self-enrollment/profile
access, contradicting the previously reviewed Main policy. Two actual runs each
produced 1 PASS / 1 FAIL. The corrected fixture explicitly rejects Worker own
enrollment, profile read and revocation with 403, retains cross-scope/initial
password denials, then verifies authorized Representative operations and audit
provenance. Final 2 PASS. No production permission or identity rule changed.
Formatting, native-config lint and affected compilation passed.

## Additional evidence

| Area                      | Actual result and scope                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR                        | 1 PASS: real PG approval, counts, expiry/replay and worker fallback rules                                                                                                   |
| Configuration image       | 1 PASS: full AppModule, pre-Region read and logout revocation; synthetic source                                                                                             |
| Account/Face persistence  | 2 PASS: canonical entity columns, encrypted synthetic enrollment and revocation; mocked Face adapter                                                                        |
| Native main close/startup | 2 PASS: admitted transaction drains before pool shutdown; startup failure sanitizes private inputs                                                                          |
| Backup/restore            | 2 PASS, 1 Linux SKIP: canonical90-table and historical63-table fixtures, two evidence files each                                                                            |
| Metadata APIs             | 1 PASS: software-only AppModule Site/Zone/Camera flow without AI calls                                                                                                      |
| Native main HTTP          | 1 parent plus7 subtests PASS: bootstrap, readiness/headers, DB outage/recovery, migration-history readiness, login/password/cookies, scoped configuration revisions, logout |
| Native main replay        | 1 PASS: exact committed observation command survives response loss and process restart                                                                                      |

These are 18 passing Node test entries across eight commands, including the
grouped native-main parent. They are not 18 independent product journeys or a
single full-suite run. Earlier89 PG cases belong to the preceding eight runs.
All production code is byte-identical across these qualification artifacts;
only the explicitly identified enrollment fixture changed.

The native runtime uses actual compiled `main` with production configuration and
real isolated PostgreSQL, without provider overrides. Test IPC controls `app.close`
only in its wrapper; it is not a production shutdown API or Linux SIGTERM proof.
AppModule tests are separately identified above and use test provider overrides.

Restore checks compare rows, constraints, indexes, functions/triggers, column
types/defaults/flags and authenticated private reads. Missing/corrupt media is
refused. Windows backup quiescence forcibly stops its own children; it is not
graceful shutdown acceptance. No real camera, model or human Face evidence used.

## Ownership, retention and remaining gates

All20 cleanup receipts were independently checked:40 recorded fixture schema
names are absent; the original17 namespace names remain. This is not a byte audit
of foreign tables. Actual website/PG owner guards passed before and after tests.
Only owned disposable schemas at5433 were used;5434 and website data were untouched.

Evidence: `main-tuan-convergence-20261018-v1/runtime-result-v4.json`, matching logs,
source/compiled SHA256 pins, cleanup receipts and recovery artifacts in the
existing local Main0dd integration run. The carrier archive is retained there.

The carrier anchors Root415d8e7 and has a frozen frontend. Do not replace current
Root Web b044107 with that frontend. Any integration must preserve current UI,
review the actual combined diff and receive authorization. The carrier is local,
not pushed, merged, deployed or served. Independent Backend review is still open:
the existing Herdr Codex pane asks to sign in again. Linux runtime recovery/SIGTERM,
native frozen CI, browser/UAT and whole phase2–7/model acceptance remain open.
