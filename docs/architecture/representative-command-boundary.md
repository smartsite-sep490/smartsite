# Representative account command boundary

The three representative account writers retain the existing Site Manager rule:
the actor must manage the requested Site. Admin is not a substitute. This applies
to creating a representative for an existing Contractor, registering a Contractor
and its first representative together, and renaming an exclusive representative
profile.

The controller supplies a server-only context bound to the original request. The
write transaction reauthenticates that request, verifies the active account, and
holds the exact Site Manager role assignment. A revoked session, disabled account,
removed role or different Site cannot authorize a write from a stale guard result.
DTOs cannot supply the actor or bypass this context.

Both creation flows use `USER_SITE_REPRESENTATIVE_CREATE`. The combined flow keeps
Contractor, Site participation, account, role, representative grant and assignment
writes in one transaction. An installed authority journal must have reviewed
capture for all six sources. An incomplete journal fails before business writes;
the existing no-journal compatibility path still rechecks the actor and Site scope.
The request descriptor includes Site/Contractor identifiers or the combined-create
flag, without credentials, account names or password hashes.

Rename preserves expected-name and exclusive-profile checks. Display-name changes
are metadata, not a fabricated authorization revision. Contextless internal
callers remain legacy/unattributed; they do not establish trusted history.

The co-located service/controller is mandatory in reviewed source and derived
runtime release inventories. Omitting it invalidates that release before worker
claims. This does not complete writer closure for other Workforce or bootstrap
entry points, install the journal, qualify historical authority, or enable MF06.

Focused coverage lives in `representative-command-context.test.ts`,
`integration/representative-command.integration.test.ts`, and the missing-source
case in `mf06-runtime-scheduler.test.ts`. PostgreSQL checks use a file-owned schema
on dedicated test port 5433; they do not exercise a deployed website or live AI.
