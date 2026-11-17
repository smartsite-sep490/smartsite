# Operator-issued camera worker generation

This is a trusted Backend operator command, not a worker enrollment API. The
worker receives a camera-scoped credential artifact; it never receives database
credentials. Issuance alone does not mean a source opened, a model ran, or a
configuration was loaded. Automatic worker consumption, renewal and runtime
adoption remain separate gates.

Run the compiled `apps/backend/src/scripts/provision-camera-worker.ts` entry
point with all four arguments:

```text
--camera-id <UUID> --lease-ms <1000..86400000>
--output <new absolute private file>
--database-identity <host:port/database/schema>
```

Supply the explicit database connection through the existing environment
variables (`DIRECT_URL`, `DATABASE_URL_UNPOOLED`, or `DATABASE_URL`, in that
priority order), plus `DATABASE_SCHEMA` and `AI_CONFIGURATION_CAMERA_IDS`.
`DATABASE_SCHEMA` is local to this operator command; it does not alter the shared
runtime or migration configuration. It must be a lowercase PostgreSQL identifier
of at most 63 characters, excluding public and reserved pg_ schemas. Connection
URL `options` overrides are refused. The command sets both TypeORM schema and
connection search_path, then verifies the actual connected database and schema.
It never runs migrations or creates a schema.

The output directory must already exist and resolve directly, without a symlink
parent. POSIX ownership/private mode is checked. **Windows directory ACL privacy
must be verified by the operator before real issuance; this command does not
certify Windows ACLs.** No real provisioning should use an unverified directory.

Output is created exclusively, never overwritten. The bounded credential is
written and fsynced before the issuance transaction commits. Delivery failure
rolls back the new generation and supersession. An empty or populated artifact
is retained on failure: inspect database state and the private artifact before
retrying, using a fresh output path. A commit/connection failure can be ambiguous;
do not infer success from the presence of a file. Never publish its contents.

The CLI prints only static success/failure text. Do not pass secrets through
arguments or paste connection environment/artifacts into logs, PRs or chat.

## Explicit tracked source transition

For an already claimed `EPISODE_TRACKED` generation, the trusted operator can
append all three transition arguments to the ordinary issuance command:

```text
--transition-from-generation <exact current generation UUID>
--transition-command <new command UUID>
--transition-reason <CONFIGURATION_CHANGED|VIEW_CHANGED|PROFILE_CHANGED|SOURCE_RESTART|LEASE_RENEWED>
```

This is a compare-and-swap operation, not an automatically retryable enrollment.
A stale expected generation or a non-tracked generation is refused. A tracked
generation that was revoked but not superseded can be replaced only when no
different current generation exists; its original revocation time is retained.
Under the Camera transaction lock, the command permanently retires the camera's
old active technical subject heads and classifies unfinished old raw frames.
Coordinators become `REVIEW_ONLY` with transition provenance; non-coordinator
parts become `PART_EXPIRED` with their original null result, as required by the
existing schema. No synthetic part0 or captured retirement event is inserted.
Head retirement stores the server command, decision time and old/new generation
bindings. Original raw bytes, hashes, receipts, sealed frame results, watermarks,
evidence and business episode history are retained. Existing episode collection
is sealed through the shared retirement helper; findings, reviews and read
revisions are unchanged. Technical retirement is neither proof of a Zone exit
nor resolution of a safety finding.

Credential delivery and all transition changes commit or roll back together.
Concurrent requests from the same expected generation cannot both succeed.
Late old-generation evidence may still be retained through existing review-only
intake; it cannot reopen a retired head or become operational LIVE admission.

The fresh worker must use the newly delivered generation/session, load and ACK
the current bundle, and start new subject segments. Ordinary issuance without
these arguments retains its legacy behavior on legacy/unclaimed cameras. It is
refused while a camera owns an unsuperseded tracked generation, active technical
heads or unfinished tracked frames, so it cannot silently bypass the fence.
Profiles without tracked storage remain compatible.
Automatic supervisor stop/drain/restart orchestration, physical source/model
qualification and deployment remain separate integration gates.

## Conditional replacement of a current owner

Trusted supervision can additionally pass `--expected-current-generation <UUID>`.
The generation must still belong to this Camera/Site, be current and neither
revoked nor superseded when checked under the Camera lock. If another issuer or
revocation won first, nothing is issued or delivered. Credential lease expiry
alone does not erase current ownership; the old expired credential remains
unusable for LIVE admission while the trusted issuer can create a fresh lease.

On an unclaimed/legacy source, use this condition with ordinary issuance. On an
already tracked source, also supply the three explicit transition arguments,
using the same expected generation UUID in both conditions. The condition never
bypasses tracked storage/head/pending checks. Disagreeing owner conditions are
rejected before database acquisition.

This lets a future supervisor replace a credential consumed by failed startup
before any tracked claim, while also refusing automatic renewal of a revoked
tracked generation. Deliberate manual recovery of a revoked tracked generation
continues to use the explicit transition without this stricter current-owner
condition. The supervisor must obtain the expected owner from its trusted issuer
state, never from arbitrary worker output, and must still await its owned prior
child's exit before replacement. This option does not install a supervisor,
establish cross-host ownership or declare configuration/source readiness.
