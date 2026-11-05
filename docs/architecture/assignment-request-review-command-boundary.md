# Assignment request and Safety review command boundary

A Contractor Representative requests a Worker assignment within the requested
Site, their Contractor grant and one active participation covering the complete
requested interval. Overlapping participations are searched for a valid covering
record instead of choosing an arbitrary row. Adjacent intervals are not stitched.
The Worker, grant, Contractor, participation and Zone scope are held through write.

The original bearer, active account and current scoped CR role are rechecked in
the request transaction. Safety review independently rechecks the current Safety
Officer role for the stored request's Site, locks the request, rejects requester
self-review and non-pending state, increments version and saves its audit atomically.
Actor and command context must identify the same account. Missing requests remain
404; access to another Site remains denied. Neither step approves Zone access.

ASSIGNMENT_REQUEST and ASSIGNMENT_SAFETY_REVIEW capture the assignment source with
actor/request hash and commit receipt. Audit failure rolls back the assignment,
command and revision; no policy-version increment is added to these two stages.
The controller is now a required source/runtime release file. Optional-context
legacy callers remain unattributed rather than receiving a fabricated actor.

Focused and isolated PostgreSQL proof includes the overlap regression, current
role/session loss, scope, self-review, optimistic state and atomic audit. Frozen
journal proof remains STAGING/no active epoch. Site Manager decision/revocation,
Team, complete writer closure and operational acceptance remain separate gates.
