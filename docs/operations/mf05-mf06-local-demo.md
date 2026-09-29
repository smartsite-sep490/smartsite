# MF05/MF06 local end-to-end demo

This runbook creates a local Site, Camera, one full-frame PPE Region and one restricted Region, then runs the companion `smartsite-ai` YOLO11s worker against a permitted video, laptop camera or RTSP source. It also connects exact-frame JPEG evidence to the scoped Safety Alert review API. It does not decide identity/authorization for `AUTHORIZATION_REQUIRED` Zones.

## 1. Start the application

From the `smartsite` repository, create one canonical real directory for local evidence. Do not use a symlink or junction. The Compose override mounts it read-only into the Backend container; this adapter is for development and demonstrations, not production storage.

```powershell
$evidenceRoot = '<absolute-real-directory-for-local-demo-evidence>'
New-Item -ItemType Directory -Force $evidenceRoot | Out-Null
$env:EVIDENCE_LOCAL_HOST_ROOT = (Resolve-Path $evidenceRoot).Path
docker compose -f infra/compose.yaml -f infra/compose.evidence.yaml up -d --build postgres backend web --wait
```

On a new local database, create the first Admin interactively:

```powershell
docker compose -f infra/compose.yaml run --rm backend node dist/scripts/bootstrap-admin.js
```

Keep credentials out of command arguments and Git. Put them only in the current terminal session, run the idempotent setup, then clear them:

```powershell
$env:SMARTSITE_DEMO_ADMIN_USERNAME = '<admin-username>'
$env:SMARTSITE_DEMO_ADMIN_PASSWORD = '<current-or-temporary-password>'
# Set only when the current password is still temporary.
$env:SMARTSITE_DEMO_ADMIN_NEW_PASSWORD = '<new-password>'

$demo = node scripts/mf05-mf06-demo-setup.mjs | ConvertFrom-Json
$demo

Remove-Item Env:SMARTSITE_DEMO_ADMIN_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:SMARTSITE_DEMO_ADMIN_NEW_PASSWORD -ErrorAction SilentlyContinue
```

The setup reuses the exact demo records on later runs and fails closed when existing codes point to different policies, geometry or resources.

## 2. Allow the AI worker to read this Camera

The configuration endpoint denies every Camera by default. Recreate only the Backend with the generated Camera UUID:

```powershell
$env:AI_CONFIGURATION_CAMERA_IDS = $demo.cameraId
docker compose -f infra/compose.yaml up -d --force-recreate backend --wait
```

For multiple local demo cameras, use comma-separated UUIDs. Do not use a wildcard.

## 3. Run verified YOLO11s

The model spec and outbox are local files and remain outside Git. The model spec must identify the exact checkpoint, SHA-256, five-class map and runtime device. Follow the training and artifact-spec sections in the companion [`smartsite-ai` README](https://github.com/smartsite-sep490/smartsite-ai) to create and review this file. From the sibling `smartsite-ai` repository:

```powershell
$env:SMARTSITE_AI_BACKEND_INGESTION_URL = 'http://127.0.0.1:3000'
$env:SMARTSITE_AI_BACKEND_SERVICE_TOKEN = 'smartsite_local_dev_service_token_only'

$video = (Resolve-Path '..\smartsite\apps\web\public\assets\morteza_ppe_test_video.mp4').Path
$modelSpec = '<absolute-path-to-reviewed-yolo11s-artifact.json>'
$outbox = Join-Path $env:TEMP 'smartsite-mf05-mf06-demo-outbox.sqlite3'

uv run --frozen --extra cuda126 smartsite-ai-camera-worker `
  --source $video `
  --stream-id 'mf05-mf06-demo' `
  --camera-id $demo.cameraId `
  --camera-external-id $demo.cameraExternalId `
  --ppe-region-id $demo.ppeRegionId `
  --model-spec $modelSpec `
  --outbox $outbox `
  --evidence-dir $evidenceRoot `
  --target-fps 10
```

The command above uses the NVIDIA CUDA 12.6 profile. On a machine without an NVIDIA GPU, set the artifact device to `cpu` and replace `--extra cuda126` with `--extra vision`. The business pipeline and event contracts remain the same; only inference throughput changes.

Use `--source 0 --live` for the laptop camera. Put credentialed RTSP URLs in `SMARTSITE_AI_WORKER_SOURCE`, omit `--source`, and add `--live`; do not put camera credentials in shell history.

## 4. Inspect the result

Open <http://127.0.0.1:5173>, choose **Safety Alerts**, and sign in with the changed Admin password. Select `DEMO-SITE` and inspect `PPE_VIOLATION` or `RESTRICTED_ZONE_INTRUSION` alerts, their source observations and available exact-frame evidence. The browser receives the JPEG through the authenticated Backend route; it never receives the local filesystem path or raw `local://` URI.

The worker exit JSON must show zero pending and terminal outbox entries. A video can produce no alert when the model does not emit explicit negative-PPE evidence or no tracked person remains inside the restricted polygon for the confirmation window. This is an evidence rule, not a worker failure.

## 5. Stop local services

```powershell
Remove-Item Env:AI_CONFIGURATION_CAMERA_IDS -ErrorAction SilentlyContinue
Remove-Item Env:SMARTSITE_AI_BACKEND_SERVICE_TOKEN -ErrorAction SilentlyContinue
docker compose -f infra/compose.yaml -f infra/compose.evidence.yaml down
Remove-Item Env:EVIDENCE_LOCAL_HOST_ROOT -ErrorAction SilentlyContinue
```
