# Opt-In Analyzed Overlay Metadata on the Existing Raw Camera Stream (Contract Slice 1)

This document defines the canonical, opt-in wire packet for **pixel-free aligned overlay metadata**
(`type: "overlay-metadata"`, `overlayVersion: 1`) intended to be negotiated alongside existing
`media-frame` (`mediaVersion: 1`) packets on the authenticated raw camera stream.

This is a **contracts-only canonical foundation slice**. Existing defaults and runtime paths remain
unchanged:

- `parseCameraMediaFrame` (`type: "media-frame"`, `mediaVersion: 1`) is unchanged.
- `parseCameraPreviewFrame` and `parseCameraPreviewResponse` (`GET /api/v1/sites/:siteId/cameras/:cameraId/preview`) remain unchanged.
- No Backend route, Cloud Run config, AI worker endpoint, or Web UI consumer is activated by this change.

---

## 1. Packet Specification (`CameraOverlayMetadataFrame`, `overlayVersion: 1`)

Anchored on the validated frontend prototype shape (`e90a8a2a` `overlayMetadataTransport.ts` +
`ppeFamilyOverlaySummary.ts`), exported from `@smartsite/contracts/camera-preview` and `@smartsite/contracts`:

- `type`: exact string `"overlay-metadata"`
- `overlayVersion`: exact integer `1`
- `sourceKind`: exact string `"LIVE"` (`REPLAY` is rejected; aligned live overlay requires live monotonic clock/sequence provenance)
- `cameraExternalId`: non-blank UTF-8 string (`1..128` UTF-16 code units, no NUL `\u0000`, no lone surrogates)
- `sessionId`: canonical UUID string (`36` characters with hyphens)
- `sequenceNumber`: canonical unsigned int63 decimal string (`0` or `[1-9][0-9]{0,18}`, `<= 9223372036854775807`)
- `capturedAt`: valid RFC 3339 timestamp with `T`/`t`, timezone offset (`Z` or `±HH:MM`), and valid calendar date
- `width`, `height`: integer analyzed coordinate dimensions in `1..1280`
- `zoneAnchor` _(optional)_: `"BOTTOM_CENTER"` or `"BOX_CENTER"` (omitted when absent; never `null`)
- `zonePolygons`: array of `0..64` items `{ regionId, geometryVersion, coordinates }`:
  - `regionId` non-blank `1..128` without `\u0000`, **case-insensitively unique** within one packet (prevents ambiguous polygon revisions)
  - `geometryVersion`: safe integer `>= 1`
  - `coordinates`: `3..64` normalized `[x, y]` points in `[0, 1]`
- `detections` _(PPE track array, `0..256` items)_: unique `trackId` per packet, normalized `[0, 1]` `boundingBox`, `ppeStatus` scoped strictly to `PPE_ITEMS` (`HARD_HAT`, `SAFETY_VEST`, `GLOVES`, `BOOTS`, `GOGGLES`, always containing `HARD_HAT` & `SAFETY_VEST`), optional consistent `alertState` & `confirmedMissingItems`
- `zoneDetections` _(Zone track array, `0..256` items)_: unique `(trackId, regionId ?? null)` (case-insensitive `regionId`), normalized `[0, 1]` `boundingBox`, optional policy/zone state
- `modelObjects` _(optional)_: `CameraPreviewModelObjects` preserving raw detector `OBJECT_DETECTION_ONLY` diagnostics (`modelFamily: "yolo11s"`, `experimental: true`, `scope: "OBJECT_DETECTION_ONLY"`, `artifactId`, 64-hex `artifactSha256`, `0..512` normalized boxes matching `EXPERIMENTAL_OBJECT_CLASSES`).
  - Preserves **`PRESENT_ONLY` safety semantics**: `fullbody-Harness` and `Lanyard-Hook` appear only as positive raw objects (`classId` `13` and `14`), never in `ppeStatus`, `confirmedMissingItems`, or negative `NO-*` classes.

### Hard Rejection Guarantees

- **No image fields**: `imageDataUrl`, `image`, `imageBytes`, `imageSha256`, `jpeg`, `jpegBase64`, `dataUrl`, `pixels`, `frame`, `bytes`, plus any unknown keys, are rejected.
- **No mixed discriminators**: `mediaVersion`, `previewVersion`, `schemaVersion` are forbidden on `overlay-metadata`.
- **Bounded packet size**: `MAX_CAMERA_OVERLAY_METADATA_BYTES = 32_768` bytes (`32 KiB` UTF-8 JSON line limit).
- **Zero JSON ambiguity**: UTF-8 payload parsing (`parseCameraOverlayMetadataPayload`, `parseOptInCameraMediaStreamPayload`) rejects malformed UTF-8, duplicate JSON keys (including escaped keys), explicit `null` optionals, `undefined`/`NaN`/`Infinity`/`-0`, and contradictory `ppeStatus`/`confirmedMissingItems`/`alertState` combinations.
- **Exact pairing check**: `isAlignedMediaAndOverlayIdentity(media, metadata)` verifies matching `cameraExternalId`, `sessionId`, `sequenceNumber`, and instant `capturedAt`.

Synthetic wire vectors live at `contracts/examples/camera-preview/opt-in-stream-vectors.json` (`SYNTHETIC_CONTRACT_EXAMPLES_NOT_OPERATIONAL`).

---

## 2. Explicit Opt-In Negotiation Plan (`video-stream`)

Goal: avoid opening a second streaming HTTP connection (which halves the `2/camera, 4/process` viewer limit) and eliminate duplicate 1280px JPEG polling (`GET /preview`) while in Live mode, without breaking any existing consumer.

### Step 1 — Contracts Only (This Slice)

- Publish versioned `CameraOverlayMetadataFrame` (`overlayVersion: 1`), `parseCameraOverlayMetadataFrame`, `parseCameraOverlayMetadataPayload`, `parseOptInOverlayMetadataVersion`, and `parseOptInCameraMediaStreamPacket` / `parseOptInCameraMediaStreamPayload`.
- Default callers ignoring `overlay-metadata` remain unaffected; `parseCameraMediaFrame` remains unchanged.

### Step 2 — Edge AI Producer (`smartsite-ai`, vendored from immutable Main SHA)

1. Vendor exact `@smartsite/contracts` commit SHA & schema bounds.
2. Extend `AnalysisPreviewObserver` (`runtime/analysis_preview.py`) to expose pixel-free `overlay-metadata` dicts (`<= 32 KiB`, without running Pillow 1280px JPEG encode).
3. On `/v1/realtime/video-stream`:
   - Default (query parameter `metadataVersion` omitted): retain identical behavior — `reserve()` accepts only `cameraExternalId` query param and streams ONLY `media-frame` (`mediaVersion: 1`) NDJSON lines.
   - Explicit opt-in (`metadataVersion=1`, `source_kind == "LIVE"`): accept `cameraExternalId` + `metadataVersion=1` on the **same single reserved NDJSON stream**; emit `media-frame` lines and latest valid `overlay-metadata` lines sharing the same capture identity (`cameraExternalId`, `sessionId`, `sequenceNumber`, `capturedAt`). Any unsupported `metadataVersion` returns HTTP `400 INVALID_PREVIEW_QUERY` before streaming.

### Step 3 — Platform Backend Proxy (`apps/backend`)

1. `CameraPreviewController.video()` (`GET /api/v1/sites/:siteId/cameras/:cameraId/video-stream`) parses optional `metadataVersion` strictly with `parseOptInOverlayMetadataVersion`:
   - Omitted: forward zero query extra upstream (identical to today); any other unknown query parameter still fails with HTTP `400`.
   - `1`: forward `metadataVersion=1` upstream; keep `X-Accel-Buffering: no`, `Cache-Control: no-store`, `redirect: 'error'`, and enforce `32_768` byte bound on `overlay-metadata` lines (`262_144` on `media-frame`) using `parseOptInCameraMediaStreamPacket(packet, { overlayVersion: 1 })`.
   - Note: `mediaViewers` counts 1 viewer slot for the multiplexed stream instead of consuming 2 slots; REPLAY cameras remain fail-closed (`metadataVersion=1` rejects REPLAY or falls back before stream emission).

### Step 4 — API Client & Web (`packages/api-client`, `apps/web`)

1. `SmartSiteManagementClient.streamCameraVideo` adds an opt-in option `{ overlayMetadataVersion?: 1, onOverlayMetadata?: (frame: CameraOverlayMetadataFrame) => void }` using `parseOptInCameraMediaStreamPayload`.
2. `FocusedCameraMedia` enables `overlayMetadataVersion: 1` when `mode === 'live'`, feeds `overlay-metadata` straight into `useScopedOverlayMetadata` / `liveOverlayAlignment`, and turns off redundant `GET /preview` JPEG polling while streaming live (`useScopedCameraPreview({ enabled: !aiPaused && mode === 'ai' })`).

### Rollout & Rollback Safety

- **Mandatory deploy order**: Contracts (`main` SHA) -> SmartSite-AI -> Backend Cloud Run -> Web.
- Because `metadataVersion` is strictly **opt-in**, older Web bundles, older Backend revisions, and legacy `parseCameraMediaFrame` callers never request or receive `overlay-metadata`. Each layer is independently reversible with zero DB migrations.
