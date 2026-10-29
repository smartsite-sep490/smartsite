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
