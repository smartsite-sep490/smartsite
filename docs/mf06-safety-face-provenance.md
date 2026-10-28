# Safety-purpose Face provenance

The additive migration supplies the missing Safety-purpose metadata represented
in the reviewed ERD: a database-owned hidden profile revision and append-only
`safety_face_consent` / `safety_face_consent_revocation` receipts. Existing enrollment
fields, encrypted templates, public response projections and roles remain unchanged.
No legacy/enrollment consent becomes Safety consent, and the migration seeds none.

The fresh migration identity is `CanonicalSafetyFaceProvenance1794268800000`.
Historical candidate `1791590400003` is preserved outside this Main extraction; do
not modify or rerun an applied historical migration. Existing purpose tables,
revision columns or guard functions require an explicit reviewed upgrade; this
migration refuses them. Startup migration execution and synchronize remain disabled.

Consent binds an active supervised profile's exact revision, Safety purpose, source
record/hash, actor and finite time. Revocation is another immutable receipt. Updates,
deletes and truncation are refused. Populated rollback requires forward recovery.
Migration and guards pin the target schema; temporary shadows, inherited parent
tables and missing Main consent/deletion prerequisites are refused.

The private metadata reader scopes by Site, active Worker/profile, reference/model,
revision and latest eligible consent, excluding revoked consent and deleted profiles.
It returns no encrypted template and does not verify a face or grant Zone access.
It is not registered as an API/provider and no receipt-writing endpoint is added.

Finalization requires an active SERIALIZABLE transaction. Grant/revocation creates
a new profile tuple version without altering profile values or rotating the revision.
This fences readers whose snapshot predates a winning consent change. The final
caller must keep its context checks and result append in this transaction and retry
the entire transaction on serialization/deadlock errors. A preliminary unlocked
metadata read is provisional and cannot replace final validation.

Owned-schema PostgreSQL checks cover fresh registration/metadata, populated profile
byte preservation, no implicit consent, scope/revision/revocation, both concurrent
revocation orderings, new grants after snapshot, immutable history, temporary-table
forgery and rollback boundaries. Current Main Face consumer checks remain separate.
These checks do not establish real consent, Face accuracy, trusted candidate binding,
runtime readiness, current website rollout or production acceptance.
