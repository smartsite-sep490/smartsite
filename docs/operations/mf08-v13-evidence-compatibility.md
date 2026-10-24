# Approved MF08 observation v1.3 evidence compatibility

The owner approved exactly two reader files and the v1.3 full-frame SHA guard on
20October. No other MF08 business flow, role, permission, Incident status or
notification behavior is changed.

- `reviewRawEventIsConsistent` explicitly selects the eight-family validator for
  v1.3; existing versions retain the legacy validator. Stored payload/header/hash
  and captured-time checks remain. Deleted-camera raw history remains distinct
  from an active-camera identity review.
- `readFrameForIdentityReview` accepts that explicit version and requires the
  selected event evidence SHA to match the actual protected JPEG bytes for v1.3.
  Mismatch returns the existing409 conflict. Older versions keep their existing
  behavior. Historical Site/alert mappings, conflicting-Site checks, session,
  camera, full-frame kind, local path/symlink/size/JPEG guards remain.
- The default exported contract validator still rejects v1.3. This does not
  enable ingestion, a producer, model, runtime worker or eight-family policies.

## Evidence

The parser-only V1 proposal was withdrawn: the actual candidate method accepted a
different synthetic disk JPEG despite the event's declared SHA. V2's guard passed
three real-JPEG boundary cases outside source; nine parser cases and an exact
two-file semantic shadow typecheck also passed before approval.

After approval Root observed an actual source RED on v1.3 admission, applied the
pinned two-file V2 and updated the now-obsolete MF08-rejection assertion. Agy p8
added two focused evidence cases using the existing fixture, preserving its v1
defaults and legacy reread behavior. Final34 affected cases across three files
passed in1.574s; scoped TypeScript and four-file lint exited0. Failures remain.

The evidence-test file is approximately600lines, above the400 target but below
the700 exception limit; the existing shared fixture was reused rather than
duplicated. Tiny JPEG fixtures are metadata/control checks, not model or human GT.

Current source is private/local. Main contract publication, full ingestion and
capability/policy compatibility, PPE inbox delivery, calibrated Worker identity,
authority coverage and camera/browser/full-flow acceptance remain separate gates.
No DB/runtime/model/camera, push/merge/deploy or notification schema change occurred.
