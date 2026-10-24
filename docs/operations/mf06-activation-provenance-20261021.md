# Controlled activation provenance

Task2 cannot qualify a CLOSED epoch merely from its state, baseline and commit
receipt: retained guards also permit an unused STAGING epoch to be closed. That
closure is not evidence it ever passed controlled READY adoption. This is a
qualification ambiguity, not a proven deployed ALLOW bypass; no qualified reader
or real worker is currently registered.

The still-unregistered1793059200000 candidate now adds nullable `activated_at`
to `authorization_history_epoch`. The new epoch guard assigns it from the DB
clock only after the controlled nested STAGING-to-READY checks succeed. Initial
inserts require NULL; baseline linking cannot alter it; subsequent GAPPED/CLOSED
transitions preserve it. A timestamp must be at or after a non-null baseline.
No old history is backfilled or declared adopted. No canonical70 applied migration,
frozen predecessor SQL body or existing entity/business name is rewritten.

This is an iteration of an unregistered capability, previously exercised only in
fresh disposable schemas. Earlier candidate commits/proofs remain available. Any
future rollout must use the new exact guard/profile/source pins rather than the
earlier draft. The column is an additive operational-history extension; coordinate
its ERD/release mapping and candidate migration slot before registration/deployment.

Capture preflight treats the presence of only this column as a partial capability
and rejects it. The complete new profile requires its exact nullable timestamptz
shape without default/generated/identity behavior. Conversely a new function/trigger
without the column is unavailable. Unused down removes the column and restores the
exact predecessor; down refuses any non-null activation marker/adopted state.

Actual intended-protocol regression:9PASS/1FAIL because the marker did not exist.
Final guard suite11PASS includes controlled marker creation, timestamp preservation,
closed-but-never-adopted NULL marker, forged insert/update refusal, both partial
schema directions and existing rollback/refusal behavior. The affected original
WEB-session cutover suite14PASS in a separate run. Narrow compiles/four-file lint0.
Owned schemas independently absent and prior namespace names unchanged afterward;
not a table-byte audit. No current website/schema, model, capture or cloud mutation.

Evidence under:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1`.
See `authority-control-red-v4-proof.json`, `authority-control-green-v6-proof.json`,
`authority-cutover-service-green-v5-proof.json`, `authority-activation-compile-green-v2.log`,
`authority-activation-service-compile-v1.log` and `authority-activation-lint-v1.log`
(three source files plus the earlier test), `authority-activation-lint-v2.log`
(final test extension). The final11-case run additionally compares the exact SQL
timestamp text through READY-to-GAPPED-to-CLOSED, retaining microsecond precision.

Root identified the ambiguity and implemented the marker. Agy p7 supplied the
bounded gap report; no timestamp/reader claim is accepted merely from peer prose.
Reader qualification still requires the actual operational release/writer review,
exact installed profiles, activation and commit witness known by event time,
bounded epoch window, immutable baseline/archive integrity and relevant history
gaps. Worker identity remains independently unestablished. Existing reconstruction
continues to report coverage/identity false; no flags were promoted by this change.
