# MF01 Worker account provisioning

Contractor Representatives can create a new Worker profile and its linked login account through
**Worker Onboarding** (`/worker-onboarding`). They choose one of their assigned Sites and an active
Contractor they represent, then enter name and username. The Backend sets the initial password to
`12345678`; the UI displays it and does not require password entry. The Worker can sign in immediately and may change it later.
The Backend generates
the Worker code (for example `W000001`) when saving and returns it for display in the success message
and roster. After creation, the supervised face-enrollment workflow is available on the same page.

The page also lists the selected Contractor's workers at that Site, across all roster pages,
with search by code/name, Worker status and account-link status. Ownership belongs to the
Contractor, rather than only to the Representative who created the record. Any Representative
with the same current Contractor grant and Site scope can manage those workers.

**Manage** displays the Worker code, edits the name and changes Worker status between active and suspended.
Suspension blocks entry eligibility and preserves profiles, assignments, face enrollment and
audit history. Reactivation does not grant or renew any assignment or entry permission. Worker
profile edits do not change the linked account's name, username, password, status or roles;
account administration remains a separate workflow.

## API

`GET /api/v1/sites/:siteId/contractor-worker-account-options` requires the Representative role at
the selected Site. It lists only Contractors granted to that user with active Contractor status
and currently valid Site participation. A role at another Site grants no access.

`POST /api/v1/contractors/:contractorId/worker-accounts` accepts:

```json
{
  "siteId": "<Site UUID>",
  "displayName": "Synthetic Worker",
  "username": "worker001"
}
```

The Backend checks Site role, Contractor grant and current participation before hashing the
password, and rechecks them in the write transaction. An authorized global Admin can also use
the creation endpoint. Caller-supplied roles are rejected: the account receives only `WORKER`
at the selected Site, with `mustChangePassword: false`. General account administration remains
Admin-only. Account, role, linked Worker and actor audit are committed together, or rolled back
together. The response contains `{ account, worker }` with no password or hash. The temporary
password defaults to `12345678` when omitted and allows immediate sign-in; changing it is optional. Legacy callers may
still supply `temporaryPassword`: the exact default or a password meeting the existing account policy.
Null, empty, malformed and other weak passwords are rejected. Only new Worker account provisioning
uses this default; it does not reset existing accounts. General Admin provisioning, password resets
and optionally changed passwords retain the existing password policy.

`externalId` is optional on account creation for backward compatibility with clients that supply
an existing external Worker code. The current UI omits it. When omitted, the Backend allocates
from the PostgreSQL `worker_code_seq` sequence and formats a `W` prefix with at least six digits.
Sequence allocation is safe across concurrent creations. Existing numeric codes seed the sequence;
existing profiles and codes remain unchanged. Existing legacy codes encountered during allocation
are skipped, and the database uniqueness constraint remains authoritative. Sequence gaps after
failed transactions are expected and are not filled by recycling codes. Null, empty or malformed
supplied codes are rejected. Apply the WorkerCodeSequence migration before deploying the Backend.

Duplicate username or a caller-supplied Worker code returns `409 CONFLICT`. A retry with the same username/code
does not create another account or reset credentials. A failed Worker insert also rolls back the
new account and role. An existing profile is not silently overwritten or linked to a new account.

`PUT /api/v1/sites/:siteId/contractors/:contractorId/workers/:workerId` accepts:

```json
{
  "externalId": "W001",
  "displayName": "Synthetic Worker",
  "isActive": false,
  "expectedSnapshot": {
    "externalId": "W001",
    "displayName": "Synthetic Worker",
    "isActive": true
  }
}
```

Writes require the same role/grant/active participation checks as creation and match the
Worker's Contractor and Site on the Backend. Suspended Workers can be restored by an authorized
Representative. Unknown fields, including account IDs, Contractor changes and roles, are rejected.
The Backend locks the scope and Worker, checks the expected profile and commits the profile and
actor audit together. Stale edits or duplicate Worker codes return `409 CONFLICT` without partial
changes. Repeating the already-applied state is a no-op with no duplicate audit. A successful change
also advances the Site's access-policy version. Existing clients can still update codes through this
API; the current management UI displays the code as read-only.

This is an additive API change; existing profile-only creation and Admin account APIs remain
available. Provisioning does not create or approve a Site/Zone assignment, certificate, face
profile or gate permission. These retain their current workflows and current-state checks.
