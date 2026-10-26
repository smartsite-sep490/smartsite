# Camera observation Region configuration

A Zone is business configuration; a Region is a polygon on one camera image
linked to that Zone. Drawing a Region does not annotate a training image or
identify a Worker. Backend remains the authority for role, Site scope, policy
locks and camera revision.

## Who configures what

| Existing role                              | Zone setup                                           | Camera/Region setup                                           |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| Site Manager assigned to the selected Site | Create and rename Zones; existing policy rules apply | Configure Camera observation Regions linked to existing Zones |
| Global Admin                               | Read-only Zone catalog                               | Read-only Camera/Region catalog; no Manager bypass            |
| Both roles                                 | Manager capabilities for the assigned Site           | Camera/Region writes require the assigned Site Manager role   |
| Safety Officer                             | Monitoring only                                      | No configuration controls                                     |

The Web derives explicit capabilities from the current account and selected
Site. Changing Site, credentials or capability remounts the popup's scoped state.
A current401 revokes setup even while a controlled session is waiting to clear.
Password-change-restricted accounts cannot open configuration. These controls
do not replace Backend authorization or grant a new role.

## Polygon editing

The editor supports zoom, pan, point selection, pointer drag, normalized X/Y
entry, keyboard nudge, undo of actual edits, deletion, and explicit discard.
Coordinates are normalized to the original image, accounting for letterboxing
and the viewport transform; persisted points retain the existing four-decimal
precision. Empty input, out-of-frame points, duplicates and invalid polygons
are rejected rather than silently clamped.

The first Escape on a dirty draft asks whether to discard; another Escape keeps
editing. Only explicit discard closes that dirty draft. Deleting a focused point
keeps keyboard focus inside the editor. Pending saves disable pointer and keyboard
mutations. Canceled pointers, lost capture, outside releases and blur end the
gesture without turning later hover into a drag.

An existing Region opens with a frozen camera configuration revision. Preflight
and PATCH must respect that revision. A409 retains the draft and requires review;
Web never silently adopts a newer revision or falls back to creating a new Region.
A new image is presented as a candidate; the operator must explicitly accept it
before it replaces the frozen reference. This does not prove physical camera pose
continuity or worker application.

Saving a new Region transitions the open editor to the returned Region identity
and revision. A second modified save updates that Region only after accepting a
new issued reference at the returned configuration revision. A repeat of the identical
saved polygon is blocked. The acknowledged geometry is the exact submitted snapshot,
not draft state read after a request finishes.

## Current limits and acceptance

The editor source loads the issued-reference envelope and saves through the new
reference-bound shared-client create/update methods. Requests bind the frozen
reference ID, view revision and configuration version; success requires matching
persisted manual confirmation. Expired, unissued or incoherent metadata cannot
be saved. Read APIs expose historical confirmation separately from camera pose
and worker application. Source integration is not current-demo or browser rollout. Current role policy follows Main's exact-site Manager
rules, superseding the earlier Admin-only setup description.

The editor requests an explicit configuration image through the shared Backend
client. It does not poll analyzed previews, start capture or require AI to run.
The frozen image is a Region-authoring reference, never monitoring evidence.
Before drawing, its camera identity and configuration revision must match the
selected metadata. The reference expires at the earlier of its server expiry
and five minutes from capture. Monitoring/evidence still uses its five-second TTL.

Expiry removes image pixels and disables editing/saving while preserving points
and undo history; Escape and explicit discard remain usable. Refreshing a draft
opens a read-only candidate image with its proposed points. Only explicit acceptance
rebinds the draft and reference revision; cancellation keeps the old reference.
A transient source error can preserve an unexpired frozen draft. Authorization
or scope failure clears both images and disables actions for that scoped instance.
A rejected mutation is not proof the same bearer can keep trying indefinitely.

Both create and update use the frozen reference revision through a cancellable
camera preflight. They recheck identity, active status, expiry and revision before
writing. A conflict retains the draft without automatic retry, rebase or create
fallback. An acknowledged own save advances the Region revision; a new issued reference
must be reviewed before another changed save. The old reference is not rebased.

An already-owned capture-only source is still required for real configuration
pixels. Physical-source ownership, manual viewpoint review and browser interaction
remain separate gates. Source presence and synthetic DOM tests do not mean this
code has been adopted by the currently running immutable local demo. AI/capture
must not be started merely to supply editor pixels.

Component/API checks are bounded software evidence. They do not prove real camera
rendering, pointer behavior on a physical browser, accessibility with assistive
technology, model accuracy, deployment or whole MF05/MF06 acceptance. The local
integration checklist keeps those gates separate; mobile is outside this task.
