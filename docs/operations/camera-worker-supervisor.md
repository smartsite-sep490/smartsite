# Bounded local worker supervisor prototype

This is trusted Backend/operator source, not an enabled application service or a production reconnect claim. Importing the modules starts nothing. The prototype accepts only explicit camera allowlists, a private credential directory, one retained outbox, and `127.0.0.1:5433/smartsite_test/<private-schema>`. It refuses public/unknown schemas through the existing issuer. No HTTP enrollment, business-user provisioning, migrations, roles or model adoption are introduced.

The operator composes `operatorSupervisorPorts(reviewedRuntime, issuerEnvironment)` with `superviseCameraWorker(options, ports, abortSignal)`. Only the trusted parent receives database configuration. The child receives the existing explicit worker-environment allowlist; its fixed command is `python -I -B -m smartsite_ai.tools.run_camera_runtime` with manifest, fresh credential file, expected Camera and unchanged outbox arguments. Shell execution is disabled and Windows windows are hidden. The Python environment must actually provide the reviewed runtime in isolated mode; PYTHONPATH is deliberately not inherited.

## Ownership and replacement

- Default bootstrap calls the internal unowned-camera issuer, which locks the Camera and refuses any current or unsuperseded generation, including expired-current and revoked-unsuperseded records. Concurrent implicit cold starts have one committed winner; a fresh parent cannot silently displace an existing owner. The separate manual operator CLI retains its existing explicit provisioning/recovery semantics.
- After reconciling and stopping the prior owner, a trusted operator may supply `initialExpectedGenerationId` in supervisor options. The first issuance then uses the same exact-current guarded renewal as later replacements. It still rejects revoked, stale or inactive ownership; never infer this option from a worker or auto-enable it after reboot. Invalid/empty/null initial conditions are rejected before issuance.
- The in-process guard and database issuance condition do not prove that an old physical process or another host has stopped. Cross-host resource fencing and orphan reconciliation remain release gates; operator reconciliation must precede an explicit takeover.
- Each replacement waits for the exact owned child's exit. The parent remembers the generation ID returned only after confirmed issuer transaction completion, never parses worker stdout, and passes `--expected-current-generation` on every replacement.
- `renewCameraWorkerGeneration` checks the exact current, non-revoked, non-superseded owner and active Camera under the same Camera lock used by admission/revocation. It then selects the route from Backend state under that lock: tracked uses the existing trusted source transition; NULL/LEGACY uses the existing ordinary guard. Schemas without tracked storage remain supported. Expired-but-still-current ownership permits a new credential, never reactivation of the old one. A revoked owner is never automatically recovered.
- Source transitions end technical continuity/collection; they do not resolve business findings, fabricate Zone EXIT, reset read revisions or discard raw evidence. The separate explicit manual recovery command remains an operator decision.
- Generation/session IDs and credential filenames must be fresh. The outbox path is held constant; no session claims or pending evidence are reset/copied/deleted by this module. Retention does not prove that expired-generation pending rows can be sent as current evidence; old-generation admission/review rules still apply.
- Recovery checks the same manifest bytes before each launch. Executable/manifest/cwd/credential paths must remain real, absolute paths. Operators still need protected directories/ACLs to prevent concurrent mutation between checks and use.

## Stop and failure behavior

At most three starts are permitted per prototype run, with bounded backoff. Lease budget starts before issuance; the child is bounded by both this monotonic deadline and the returned database expiry. Cancellation, lease expiry or an in-process trusted source-gap signal stops and awaits the owned child. Windows termination is reported FORCED; POSIX attempts SIGINT before a bounded SIGKILL fallback. No arbitrary PID is selected or killed.

A failed or ambiguous issue/launch/cleanup latches process-local ownership and requires reconciliation instead of blindly retrying. Keep the private artifact for investigation; file existence does not prove commit. `CANCELLED` and `EXHAUSTED` describe lifecycle only. No return value asserts READY: readiness still requires the actual bound configuration ACK and first frame. A source-gap signal is an optional trusted in-process seam, not a new remote worker-control protocol.

## Explicit test-only operator entry point

After compiling the Backend, an operator can run the existing composition explicitly:

```sh
node apps/backend/dist/scripts/run-camera-worker-supervisor.js --config /absolute/private/supervisor.json
```

Use the build's actual output path (the normal production build places scripts under
`apps/backend/dist/scripts`; a test build may use `dist/src/scripts`). Nothing registers
this command at application startup. The configuration is a regular, unlinked JSON
file, at most 64 KiB, with exactly these fields (all values below are synthetic):

```json
{
  "cameraId": "11111111-1111-4111-8111-111111111111",
  "allowedCameraIds": ["11111111-1111-4111-8111-111111111111"],
  "credentialDirectory": "/absolute/private/credentials",
  "outboxPath": "/absolute/private/retained.sqlite3",
  "databaseIdentity": "127.0.0.1:5433/smartsite_test/isolated_supervisor",
  "leaseMs": 60000,
  "maximumStarts": 2,
  "worker": {
    "pythonExecutable": "/absolute/reviewed/python",
    "manifestFile": "/absolute/private/reviewed-runtime.json",
    "workingDirectory": "/absolute/private/worker"
  }
}
```

On Windows use absolute drive paths. Optional `initialExpectedGenerationId` is only
for an explicitly reconciled prior owner, as described above. Unknown fields,
inline environment/secrets/argv, relative paths, public/reserved schemas and any
website/cloud database identity are refused. Keep this file and its directories
private; this entry point does not provision or certify OS ACLs.

Supply issuer database configuration through the trusted parent runtime environment.
Only the existing worker environment allowlist is forwarded: the AI Backend service
token/ingestion URL/source, evidence root and Python bytecode setting. Database and
admin credentials remain in the parent. Existing adapter validation still checks the
fixed executable/manifest, dotenv absence and manifest digest before launch.

SIGINT/SIGTERM request cancellation and await the owned worker. Exit 0 means the
supervisor was cancelled, exit 2 means its finite start budget was exhausted, and
exit 1 means validation/issuance/launch/reconciliation failed. These are **not**
camera readiness or model qualification. Error output is generic and never prints
configuration bytes or driver errors. This entry point does not add source discovery,
remote enrollment, configuration-change signaling or deployment activation.

## Remaining release gates

Cross-process/host ownership, host-reboot orphan reconciliation, native-driver deadlines, private Windows ACL verification, packaged-runtime provenance, target runtime activation, real ACK/first-frame readiness, draining retained old-generation rows, physical camera/RTSP smoothness and model quality/shadow/canary/rollback remain separate acceptance work. This prototype is not installed as a service and is not registered in AppModule or website startup.
