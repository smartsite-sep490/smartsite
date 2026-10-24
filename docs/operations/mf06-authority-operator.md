# Controlled authority activation operator

This is an explicit internal operation, not an HTTP endpoint, startup task, migration runner or permission grant. Do not execute against the current website until the owner approves the separate local73 cutover package and source/schema/release qualification is complete. Current schema72 remains supported with workerdisabled.

## Preconditions

Use the reviewed compiled release and matching immutable OPERATIONAL_REVIEWED manifest/source/runtime pins. Configure explicit NODE_ENV, DATABASE_URL, AUTH_JWT_SECRET, MF06_CUTOVER_MANIFEST_PATH, MF06_CUTOVER_MANIFEST_SHA256, MF06_CUTOVER_RELEASE_ROOT and MF06_CUTOVER_RELEASE_COMMIT. Other production env requirements still apply. The JWT settings/database must be exactly those of the original authenticated WEBAdmin session. No defaultDB/secret or .env guessing. MF06_ENQUEUE_ENABLED and MF06_WORKER_ENABLED must be absent/false in this one-shot process; it never starts capture/inference or workers.

The database must already have the reviewed forward capability. The command neither runs migrations nor repairs a wrong schema. Verify the expected current epoch using authorized operational tooling; null means explicitly expecting no active epoch, not overwrite-anything.

## Private input and invocation

Provide one UTF-8 JSON document on a private pipe, at most16KiB, then close the pipe. Exact fields: action="ACTIVATE", accessToken=(original WEBbearer), expectedPreviousEpochId=null or exact UUID. Unknown fields and positionalCLI arguments are rejected. Do not paste the token into an interactive terminal, argv, issue, screenshot, shell history or public log.

Windows invocation form: `Get-Content -Raw -LiteralPath <private-command.json> | & node <reviewed-build>/scripts/activate-authority-cutover.js`. Substitute paths only; obtain and handle the JSON using approved local secret controls. No real credential/input file is created by this documentation.

## Receipt and failures

Successful stdout is a whitelisted COMMITTED receipt with epoch/command/capturetime/snapshotSHA/manifestSHA/provenance/witness flag; no token or snapshot. witnessConfirmed=false still means the write committed—inspect and reconcile, do not blindly reactivate. Any error returns a sanitized message and nonzeroexit; a late error may occur aftercommit, so inspect control/epoch/receipt and originalsession state before retry. The originalWEB/globalAdmin and expectedpointer are revalidated transactionally; caller-written clientType is not trusted.

## Verification / limits

Agy initial implementation reviewed and simplified by Root: WEBguard centralized in MainAuthorityCutoverService, explicitJWT required (RED->GREEN), DBinitialization inside cleanup boundary, terminaltyping refused. Fourunitcases cover strictinput/streambudget, invalidJSON/epoch/keys, environment, provenance and safe receipt/error; imports cause no activation. Separately16actualPG servicecases prove originalsession/CAS/rollback/latecommit and MOBILE/spoofmarker refusal; schemas verified absent via independentconnection. Actual executable positivePG journey and final operationalrelease review remain pending; neither cohort proves that journey, fieldidentity, browser or productionacceptance.

## Actual owned PostgreSQL process qualification

Root subsequently built all403runtime modules from committed610951d with417source/review pins and verified the source-reviewed OPERATIONAL_REVIEWED manifest using the actual production-environment verifier. Source release qualification is not owner permission or fieldidentity/model acceptance.

Actual compiledCLI ran as separate processes against a fresh owned canonical72+directunregisteredforwardcandidate schema. OriginalrealAuthService WEBfixture account committed with witness; MOBILE refused with unchangedstate; staleexpectedpointer refused without additionalcommand/epoch/baseline; tamperedownedcopyofmanifest refused without writes and originalreleasebytes stayedunchanged. stdout/stderr checked against syntheticcredentials/token/DBpassword/JWTsecret, no leak. Ownschema removed and preexisting namespace names exact. Proof: product-rollout-461c857-20261021-v1/owned-operator-20261022013344222-666cfcdc/result.json. No actualwebsite/cloud/worker/model operation. Two additional actual executable negative cases refused missingexplicitconfig/argv with sanitizedoutput and no configuredDBtarget. No operatorprocess performance/load/deploy/field claims.
