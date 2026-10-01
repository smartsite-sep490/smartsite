# Controlled local demo runtime

This controller starts the local SmartSite application and the companion `smartsite-ai` processes
without opening extra console windows. It records child PIDs plus creation-time/command fingerprints,
the named source profile, safe endpoints and log paths under the configured data directory. Camera
credentials and the Backend service token are read from local files outside Git. The controller passes
them to selected child processes through an allowlisted environment; for this local demo only, the Web
build embeds the service token as described under **Limitations**.

## Local files

Copy [`scripts/smartsite-runtime.config.example.json`](../../scripts/smartsite-runtime.config.example.json)
outside the repository and replace every example path with an absolute local path. The controller
accepts three named sources: `mp4`, `laptop`, and `tapo`. A source argument can never be an RTSP URL.

The Backend credential file has this local-only form:

```text
Token: <local-backend-service-token>
```

The Tapo credential file is read only for the `tapo` profile:

```text
Username: <camera-account-username>
Password: <camera-account-password>
Host: <camera-lan-address>
Stream: stream1
```

The Tapo manifest must reference an environment variable instead of containing an RTSP URI:

```json
{
  "source": {
    "kind": "env",
    "name": "SMARTSITE_AI_CAMERA_TAPO_SOURCE"
  }
}
```

## Commands

Run from the `smartsite` repository. Use `--build` after application code or container inputs changed,
and at least once after installing this controller so the local-only WebSocket URL/token are baked
into the Web demo image. Normal later starts can reuse the existing images.

```powershell
pnpm demo:runtime -- start --source mp4 --build --config D:\SmartSiteData\runtime\control.json
pnpm demo:runtime -- status --config D:\SmartSiteData\runtime\control.json
pnpm demo:runtime -- stop --config D:\SmartSiteData\runtime\control.json
```

Use `laptop` for camera device `0`, or `tapo` after the workstation and camera are reachable on the
same LAN. Starting the same live profile twice is idempotent. Starting a different profile while a
runtime is live fails and requires an explicit `stop` first.
If startup cleanup fails, the controller preserves a `cleanup-required` state and requires `stop`
before another start.

`status` distinguishes process state from HTTP health. AI API readiness proves only that FastAPI is
ready. For MP4, YOLO11s and the replay source are opened when the Web realtime client connects. A
finite MP4 worker normally exits at EOF; running `start --source mp4` again replays that source without
restarting the healthy API.

Worker logs for non-credentialed MP4/laptop sources are written under `<dataRoot>/control/logs`. API
output is discarded because Uvicorn WebSocket access logs include the local credential in the URL. Operator
output is scrubbed for RTSP credentials, Bearer headers, tokens and passwords. Tapo AI child output
is discarded because native OpenCV/FFmpeg diagnostics cannot be guaranteed to redact an RTSP URI.
Use the credential-safe source probe and controller health output for that profile. `stop` terminates
only the PIDs recorded by this controller, then runs Compose `down` without `-v`, so the local
PostgreSQL volume and evidence remain intact.

## Limitations

The synchronized MP4 preview requires an AI build that supplies `previewVersion: 1`, JPEG pixels,
and detections in one WebSocket message. Web paints those pixels and normalized boxes on one canvas;
it does not use the separately playing fixture as a realtime background. Old metadata-only AI
responses are rejected with an explicit unavailable state. Image decoding holds one active image
and at most one latest pending frame; a five-second frame stall clears the realtime preview.
The deadline starts when the socket opens, including when no first frame arrives. Socket
construction failures produce a generic unavailable message, and queued callbacks from a closed
connection are ignored before reconnect starts.
The local timeline remains a separately labeled fallback. This preview is transient and does not
replace the retained evidence served by the Backend alert-review endpoints.
The controller excludes the Backend ingestion URL from the preview API environment, while retaining
its local WebSocket authentication token. Only the durable worker delivers events and retains images;
opening or replaying the diagnostic preview must not create additional business alerts.

- The local Compose profile is a demonstration environment, not a production deployment.
- A Tapo source cannot be claimed live until the source probe succeeds on the current network.
- The realtime WebSocket overlay and the durable event worker are separate AI consumers. The
  controller gives exclusive laptop/Tapo sources only to the durable worker; the WebSocket overlay is
  deliberately unavailable for those profiles until a shared frame fan-out service is implemented.
- The local Web image embeds its local-only WebSocket credential at build time. Never deploy that
  image or reuse this mechanism for production authentication.
