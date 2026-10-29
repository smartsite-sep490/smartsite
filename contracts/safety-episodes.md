# Safety episodes and personal inbox — transport preparation

Status: DTOs, read-command parser and shared-client transport exist. Backend endpoints, persistence, recipient routing, Frontend screens and rollout are not implemented by this contract slice. Calling these methods against the existing Backend can return404. No existing notification route has changed.

## Canonical surface

Types live in `src/safety-episode-api.ts` and are exported by `@smartsite/contracts`; the shared API client re-exports the consumer types. Do not create parallel Frontend DTOs.

| Method | Path                                 | Response                    |
| ------ | ------------------------------------ | --------------------------- |
| GET    | `/sites/:siteId/safety-episodes`     | `SafetyEpisodePage`         |
| GET    | `/sites/:siteId/safety-episodes/:id` | `SafetyEpisode`             |
| GET    | `/me/safety-episode-inbox`           | `SafetyEpisodeInboxPage`    |
| PATCH  | `/me/safety-episode-inbox/:id/read`  | `SafetyEpisodeReadResponse` |

All four shared-client methods accept existing RequestOptions for abort/timeout and use the existing authenticated transport. IDs are encoded as path segments. List methods preserve explicitly supplied empty filters for Backend rejection; an empty Site filter must never be interpreted as all Sites.

Episode list: offset>=0, limit1..100/default20, optional cameraId/zoneId. Inbox: offset/limit, optional siteId, readStatus ALL/UNREAD. Backend must validate UUIDs, ranges and unknown query fields. Client serialization is not authorization or validation of server data.

Sort episode list by firstObservedAt DESC,id DESC and inbox by firstDeliveredAt DESC,id DESC. Offset totals describe the current query, not a frozen snapshot; consumers deduplicate IDs and refresh page1 explicitly. Inbox unreadCount is the scoped filtered unread total before pagination, even when readStatus=ALL.

## Meaning and boundaries

- `subject` currently accepts only `EventLocalEpisodeSubject`. It is not Worker identity, cross-frame continuity or a notification admission rule. See `safety-episode-subject.md`.
- `identityDecision` reuses the existing exact-observation manual decision response, including CLEAR. Null means no verified decision; do not use a Face candidate or track ID to fill it. Backend must bind it to the episode's event and person index; a decision for another person is invalid.
- Findings keep existing alert IDs, types, subtypes, revisions and statuses. Hat may be CONFIRMED while vest remains NEEDS_MORE_EVIDENCE. There is no aggregate confirm-all command or new incident state machine.
- `findingCount` must equal the detail findings length; summary/detail contentRevision must refer to the same committed projection. `SEALED` stops collection, not business review or corrective work.
- Workflow links reuse existing Incident/CorrectiveAction statuses and scoped readers. These DTOs do not grant new Manager or contractor evidence rights.
- Evidence references identify the exact event/person/evidence index and SHA256. Never include raw storage keys, credentials or camera addresses. Unavailable evidence stays unavailable; an empty list is allowed. Fetching bytes rechecks current permissions and hash/binding.
- configurationBundleId=null is explicitly unsupported legacy context; it must not silently become a current active policy/geometry version.

## Read command and race

Body is exactly `{seenRevision: positiveSafeInteger}`. The canonical parser rejects extra keys, strings, missing/inherited values and unsafe numbers. It returns null for malformed bodies. Backend maps those to400 VALIDATION_FAILED.

Within the authorized recipient transaction: reject supplied revision greater than current contentRevision with409; otherwise set seenRevision=max(previousSeenRevision,supplied). Return unread=(seenRevision<contentRevision). A client that saw revision2 must not clear revision3 that arrived concurrently. The client preserves the server response and does not optimistically fabricate unread=false. A synthetic transport response is not proof of this database transaction.

Inbox items keep contentRevision only inside `episode`, avoiding inconsistent duplicate revision fields. The read response returns explicit current contentRevision because it contains no episode summary.

No bulk mark-all for this inbox. Existing generic mark-all must not acknowledge future episode content. Recipient identity comes from the session, never the body. List/count/read/evidence recheck current Site/grants. Denied or absent resources use existing401/403/404 behavior without cross-site existence leakage.

## Implementation gates

Persistence requires reviewed additive ERD names/indexes and migration slots, preserved old alert history, atomic projection/recipient updates and idempotent event handling. A single cutover route chooses old alert delivery OR new episode delivery. Never generate a fresh notification for each EVENT_LOCAL frame.

Tracked delivery requires a versioned, qualified continuity/admission protocol. The current schemas carry no trusted track generation. Do not turn these prepared routes on in UI before the Backend and deployment capability exist.

Focused tests cover exact paths/filters, independent findings, authentication, read-body validation, preservation of a newer unread response,401/403/404/409 and cancellation. They do not verify database races, persistence, real role scope, rendering, live inference or delivery.
