# Bounded local worker supervisor prototype

This is trusted Backend/operator source, not an enabled application service or a production reconnect claim. Importing the modules starts nothing. The prototype accepts only explicit camera allowlists, a private credential directory, one retained outbox, and `127.0.0.1:5433/smartsite_test/<private-schema>`. It refuses public/unknown schemas through the existing issuer. No HTTP enrollment, business-user provisioning, migrations, roles or model adoption are introduced.

The operator composes `operatorSupervisorPorts(reviewedRuntime, issuerEnvironment)` with `superviseCameraWorker(options, ports, abortSignal)`. Only the trusted parent receives database configuration. The child receives the existing explicit worker-environment allowlist; its fixed command is `python -I -B -m smartsite_ai.tools.run_camera_runtime` with manifest, fresh credential file, expected Camera and unchanged outbox arguments. Shell execution is disabled and Windows windows are hidden. The Python environment must actually provide the reviewed runtime in isolated mode; PYTHONPATH is deliberately not inherited.

## Ownership and replacement

- The first issuance uses the existing scoped operator provisioner. Ownership is guarded within this parent process only; it is not a distributed lock and does not prove no other parent or orphan worker exists.
- Each replacement waits for the exact owned child's exit. The parent remembers the generation ID returned only after confirmed issuer transaction completion, never parses worker stdout, and passes `--expected-current-generation` on every replacement.
- `renewCameraWorkerGeneration` checks the exact current, non-revoked, non-superseded owner and active Camera under the same Camera lock used by admission/revocation. It then selects the route from Backend state under that lock: tracked uses the existing trusted source transition; NULL/LEGACY uses the existing ordinary guard. Schemas without tracked storage remain supported. Expired-but-still-current ownership permits a new credential, never reactivation of the old one. A revoked owner is never automatically recovered.
- Source transitions end technical continuity/collection; they do not resolve business findings, fabricate Zone EXIT, reset read revisions or discard raw evidence. The separate explicit manual recovery command remains an operator decision.
- Generation/session IDs and credential filenames must be fresh. The outbox path is held constant; no session claims or pending evidence are reset/copied/deleted by this module. Retention does not prove that expired-generation pending rows can be sent as current evidence; old-generation admission/review rules still apply.
- Recovery checks the same manifest bytes before each launch. Executable/manifest/cwd/credential paths must remain real, absolute paths. Operators still need protected directories/ACLs to prevent concurrent mutation between checks and use.

## Stop and failure behavior

At most three starts are permitted per prototype run, with bounded backoff. Lease budget starts before issuance; the child is bounded by both this monotonic deadline and the returned database expiry. Cancellation, lease expiry or an in-process trusted source-gap signal stops and awaits the owned child. Windows termination is reported FORCED; POSIX attempts SIGINT before a bounded SIGKILL fallback. No arbitrary PID is selected or killed.

A failed or ambiguous issue/launch/cleanup latches process-local ownership and requires reconciliation instead of blindly retrying. Keep the private artifact for investigation; file existence does not prove commit. `CANCELLED` and `EXHAUSTED` describe lifecycle only. No return value asserts READY: readiness still requires the actual bound configuration ACK and first frame. A source-gap signal is an optional trusted in-process seam, not a new remote worker-control protocol.

## Remaining release gates

Cross-process/host ownership, host-reboot orphan reconciliation, native-driver deadlines, private Windows ACL verification, packaged-runtime provenance, target runtime activation, real ACK/first-frame readiness, draining retained old-generation rows, physical camera/RTSP smoothness and model quality/shadow/canary/rollback remain separate acceptance work. This prototype is not installed as a service and is not registered in AppModule or website startup.
