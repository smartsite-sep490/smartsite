# MF06 current camera context in saved cases

The case card and recorded-assessment dialog may show a camera's code/name from
already authorized loaded camera metadata. Both Site and camera UUID must match
the recorded assessment. The label explicitly says current catalog; it is not an
assertion that this was the camera's name at capture time. Missing/unloaded/denied
metadata produces no invented source name, Worker or Team identity.

The same optional catalog flows through RestrictedZoneView, both assessment and
request panel entry paths, History, Card and Dialog. Existing query guards clear
it after base/hard failures and scope changes; transient later-page failures may
retain authorized rows. This change adds no metadata fetch or new API/permission.
Raw camera/Zone/request/event/assessment IDs and provenance are under defaultclosed
technical details. Frame binding, outcome, authorization and media lifecycle are
unchanged. Native details, existing PpeDialog and EN/VI catalog are reused.

Agy supplied five failing cases and the UI implementation. Root observed RED,
repaired a modal-inert background-button fixture by rerendering props, repaired
an old shell-logout fixture, removed temporary component type casts and fixed a
strict indexed-access fixture type. The final affected cohort passes35cases in
five files; narrowed TypeScript and changed10file lint pass. Earlier failures are
retained. These checks do not establish browser rendering or screen-reader UAT.

Peer review dispositions: metadata hook retains authorized later-page data on a
transient error; the review's claim that every error clears data was too broad.
PpeDialog owns focus restoration. Mixed-case UUIDs from a hypothetical caller
are distinct from canonical Backend UUID output; no global scope-policy change.
No unavailable Zone name or current-label-as-historical-name is introduced.

Separate authority capability rehearsal on fresh owned5433 schemas checks the
existing unregistered cutover candidate Up/Down after canonical72 with93captured
tables' rows retained, plus the temporary fresh73 migration graph. Epoch history
was empty; this is not populated-epoch or operational coverage qualification.
The candidate remains unregistered and is not adopted on the website.

D-only evidence is under unified-corpus-tooling-20261006/demo-readiness-20261014-v1/
main-0dd7d27-integration-20261017-v1: mf06-camera-context-* logs/configs and the
product-rollout-461c857-20261021-v1 authority72-candidate proof. No push/merge/cloud,
model adoption, whole-flow or production acceptance follows from this milestone.
