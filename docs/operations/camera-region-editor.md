# Camera observation Region configuration

A Zone is business configuration; a Region is a polygon on one camera image
linked to that Zone. Drawing a Region does not annotate a training image or
identify a Worker. Backend remains the authority for role, Site scope, policy
locks and camera revision.

## Who configures what

| Existing role | Zone setup | Camera/Region setup |
| --- | --- | --- |
| Site Manager assigned to the selected Site | Create and rename Zones; existing policy rules apply | Not available through Admin-only configuration APIs |
| Global Admin | Read-only Zone catalog | Configure Camera observation Regions linked to existing Zones |
| Both roles | Both capabilities for the assigned Site | Admin capability remains scoped to the selected resources |
| Safety Officer | Monitoring only | No configuration controls |

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
Explicit comparison/reconfirmation recovery is a remaining product task.

Saving a new Region transitions the open editor to the returned Region identity
and revision. A second modified save updates that Region. A repeat of the identical
saved polygon is blocked. The acknowledged geometry is the exact submitted snapshot,
not draft state read after a request finishes.

## Current limits and acceptance

The configuration editor still obtains pixels from the existing authorized AI
preview. During the explicit AI pause, metadata and saved Regions remain visible,
but fresh drawing is unavailable. Do not remove pause or five-second evidence-pixel
guards to manufacture an available image. An independent configuration-image
contract and a manual camera-viewpoint review workflow remain open requirements.
Model training or capture must not start merely to test configuration UI.

Component/API checks are bounded software evidence. They do not prove real camera
rendering, pointer behavior on a physical browser, accessibility with assistive
technology, model accuracy, deployment or whole MF05/MF06 acceptance. The local
integration checklist keeps those gates separate; mobile is outside this task.
