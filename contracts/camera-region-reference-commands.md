# Reference-bound Region commands (MF05/MF06 C03)

Additive management transport only; the versioned Backend write handlers and shared-client/FE activation are not implemented by this contract. Existing Region APIs remain unchanged. No AI contract vendoring or rollout is implied.

Create example for `POST /sites/:siteId/cameras/:cameraId/reference-regions`:

```json
{
  "expectedConfigurationVersion": 3,
  "referenceId": "11111111-2222-4333-8444-555555555551",
  "viewRevision": 2,
  "confirmReferenceView": true,
  "polygon": {
    "coordinates": [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.5, 0.9]
    ]
  },
  "zoneId": "22222222-3333-4444-8555-666666666662"
}
```

Update at `PATCH /sites/:siteId/cameras/:cameraId/regions/:regionId/reference-polygon` uses the same body without `zoneId`. Public parsers are exported from the root and `@smartsite/contracts/camera-region-reference` for browser-safe use. Unknown fields, false/missing confirmation, malformed lowercase UUIDs, unsafe revisions and invalid normalized polygons are rejected. JSON schemas cover structure; parsers also reuse exact polygon area/intersection semantics. No actor/timestamp/permission/application claims are accepted from clients.

Successful shape validation does not prove the reference exists, belongs to the requested camera/site, remains current/unexpired, or that the actor is authorized. Backend must reauthorize the exact scoped Site Manager, lock/check the camera/reference/view versions, and append provenance atomically. A manual confirmation is distinct from physical pose validity or worker application. See the approved C03 implementation rulings in local-docs; no automatic stale retry or reference-free fallback.

The planned write path requires an active camera and equality between the current camera revision, `expectedConfigurationVersion` and the persisted reference revision. After a successful save, another save needs a newly issued reference; the UI keeps draft points and refreshes without automatically resubmitting. Reconfirming identical coordinates against a fresh reference must record new provenance. These are requirements for the future handlers, not guarantees supplied by these parsers.
