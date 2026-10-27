# Camera worker generation provisioning

This is a trusted Backend operator command, not a Web role, public enrollment API or worker self-registration route. It provisions one finite camera generation using the existing camera allowlist. It does not start a camera/model or send an application ACK.

Build the Backend first. Run `node apps/backend/dist/scripts/provision-camera-worker.js` from the repository with these required arguments:

```text
--camera-id <camera UUID>
--lease-ms <integer 1000..86400000>
--output <absolute new credential file>
--database-identity <hostname:port/database/schema>
```

The process environment must explicitly supply `DATABASE_SCHEMA`, a supported connection variable (`DIRECT_URL`, `DATABASE_URL_UNPOOLED` or `DATABASE_URL`, in that precedence), and `AI_CONFIGURATION_CAMERA_IDS` containing the target camera. Connection settings are read from the process environment; this command does not load a development `.env` file. Never put a connection URL, password, generation secret or service token in command arguments.

The database identity must match the selected connection and schema exactly; it is a guard against targeting the wrong database. It is not an authorization credential. No default schema is accepted. This command does not run migrations or change roles. Operators must independently be authorized for the target database and camera. Local rehearsals use only dedicated `smartsite_test` on loopback port5433 and an owned test schema; never substitute the website/main database.

## Private output and recovery

Use an existing private output directory outside the repository. Symlink/junction parents are refused. File creation is exclusive; an existing output refuses before opening the database or superseding a generation. POSIX directories must exclude group/other permissions and new files request0600. **Windows inherits directory ACLs;0600 does not establish private access there.** Provision only into a directory whose ACL has been verified separately. This implementation does not claim Windows ACL acceptance.

The artifact contains `schemaVersion`, `cameraId`, `workerGenerationId`, `streamSessionId`, the plaintext generation `secret`, and `expiresAt`. Do not print, share, commit or include it in reports. Database storage retains the secret hash, not plaintext. Success output contains no credential values.

The file is written and flushed inside the issuance transaction before commit. A local delivery failure rolls back the new generation and supersession. A process/commit/close failure can leave an empty, partial or complete recovery artifact; it is **not** proof of a committed current generation. The command keeps the artifact and refuses overwrite. Inspect database generation state before retrying with a fresh path; never blindly reuse its session. A new successful issuance supersedes the previous current generation.

Worker artifact consumption, one-time durable session claim, automatic ACK and trusted renewal on reconnect/restart are separate unfinished runtime work. A provisioned generation or saved file does not mean the camera is online, the configuration is loaded or the model is qualified.
