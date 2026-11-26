# Backend reviewed release artifacts

`mf06-reviewed-manifest.json` is the reviewed authority source/runtime inventory,
not a generated assertion that arbitrary new code has been reviewed. It contains
no credentials, Site records, images or model weights.

The normal Backend Docker build checks all listed source and Linux runtime pins,
then calls the production `verifyMainAuthorityCutoverRelease` verifier before
copying the exact manifest and source bytes into `/app/reviewed-manifest.json` and
`/app/reviewed-source`. A missing, changed, synthetic or incomplete artifact fails
the build. The runtime's checks stay enabled.

Cloud Build must use the versioned `cloudbuild.backend.yaml`, rather than an
out-of-band inline build definition. It verifies the image offline, deploys an
immutable digest without traffic, verifies the exact revision and Git SHA, checks
readiness, promotes100 percent and verifies the resulting traffic. A previously
healthy revision cannot make a failed new deployment count as successful. An
older concurrent trigger build cannot overwrite a newer Main build's traffic.

Main commits that do not change the reviewed pins reuse this artifact and the
existing authority epoch. Changes to pinned authority code require a reviewed
replacement inventory, Linux runtime hashes, migration rehearsal and canonical
epoch rollover with the actual expected previous epoch. Do not edit hashes merely
to pass the build, set review flags without reviewing writer changes, disable the
worker, or rewrite history. The deploy script explicitly stops before rollout if
the service still uses a different manifest pin.

For the initial transition from the former private image overlay, retain the old
image and database backup, apply reviewed compatible forward migrations, drain
old worker jobs, execute `dist/scripts/activate-authority-cutover.js` using the
existing authenticated operator flow, and switch the image plus all four
`MF06_CUTOVER_*` settings together. Then point the Main trigger at this versioned
build file. Do not leave two different-manifest MF06 workers active across the
epoch boundary. Startup migrations and `synchronize` remain disabled.
