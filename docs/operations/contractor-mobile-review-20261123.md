# Contractor Mobile follow-up review stack

Issue: #328. This follows the dependent review pattern used by #324.
The integration branch is `fix/schedule-assignment-ui`, based on Main
`c34d6d35c78c727622f2726b117853373c336b67`.

## Review order

| Part | Branch                                      | Behavior                                                    |
| ---- | ------------------------------------------- | ----------------------------------------------------------- |
| 1    | `fix/contractor-mobile-01-schedule-state`   | Read current assignment state after changes                 |
| 2    | `fix/contractor-mobile-02-assignment-sheet` | Refresh and explain schedule changes in Mobile              |
| 3    | `fix/contractor-mobile-03-profile-actions`  | Connect existing personal-information and Site rows         |
| 4    | `fix/contractor-mobile-04-assigned-work`    | Compact assigned work, criteria/history and one Back action |
| 5    | `fix/contractor-mobile-05-auth-forms`       | Keep login fields visible and explain password validation   |

Each review part targets the preceding branch; only part 1 targets Main.
The integration PR brings the complete stack to Main. Keep those bases during
review. Do not auto-merge or retarget dependent parts to Main.

## Schedule API compatibility and data flow

Contractor creates an assignment through the existing preview/create APIs.
Changing or cancelling it updates the underlying Worker schedules; the original
batch input and preview remain a historical snapshot.

`GET /api/v1/sites/:siteId/schedule-assignments?contractorId=...` now includes an
optional `currentSchedules` array in each batch, grouped by `workDate` and
`shiftId`, with `activeCount` and `cancelledCount`. An empty array means that no
referenced schedules remain. The read checks Site/Contractor authority first,
reads only schedules referenced by that page's batches in the same Site, and
uses a repeatable-read transaction so versions and schedule state agree.
Large ID lists are bounded below PostgreSQL's bind-parameter limit.

Example: two Workers originally have shift A on one day. If one changes to
shift B, the response has one active assignment for A and one for B. If the A
assignment is cancelled, its active count becomes zero and cancelled count
becomes one; the original batch input still says A.

Mobile waits for a list refresh after a successful change, shows current shifts
and partial/full cancellation, and can expand individual days. A conflict
requires reload before another confirmation. Network retries keep their command
ID; Site/batch identity is part of the request fingerprint. Backend protections
for started shifts, attendance, linked requests, grants and versions remain
authoritative.

Deploy the Backend before the updated Mobile client to show live state. Older
clients ignore the additive field. A new client on an older Backend labels its
fallback as original assignment information rather than current state.
There is no new endpoint, schema, migration or request-command shape.

## Profile, work and authentication

Existing Profile rows open the authorized scope selector and account details.
Worker details reuse the current compliance read for national ID, phone,
gender and address; identity images and certificates are not rendered there.
Contractor sees available account fields, without fabricated Worker attributes.

Assigned work preserves existing assignment, Contractor/Site, handover, version,
evidence and submission checks. It owns one shared screen header: detail Back
returns to its list, and list Back leaves the feature. Histories and criteria
can fold without discarding draft answers. Returned/rejected results remain
visible when relevant. Manual refresh remains available for both work types.

Login uses keyboard and layout events to shrink the hero and scroll the active
field into view. Password changes explain the existing Backend policy: 8–128
characters, uppercase ASCII letter, digit, special character and no unsupported
control/surrogate characters. Missing fields, confirmation mismatch, server
validation issues and incorrect current password are presented at their fields.
These client checks do not weaken or replace Backend validation.

## Verification boundaries

Each exact review head is checked for formatting, lint, affected TypeScript and
focused behavior before publishing. Frozen offline install, peer checks and the
pinned Expo SDK dependency check use the locked dependencies. Final assembled
Mobile tests and the integration PR's full CI evidence are recorded in GitHub.

Application CI runs `pnpm check`, Expo JS exports, dedicated PostgreSQL migrations
and database integration, and container readiness/Web health smoke. Regression
assertions cover partial shift changes and cancellation in real PostgreSQL.
Local Docker was unavailable during implementation; tests are never pointed at
Neon or other runtime databases.

No APK/IPA, native build, physical-device keyboard/layout acceptance, biometric
model/camera activation, production migration or deployment is claimed.
Runtime `.env` files, recipient data, credentials, screenshots and private logs
stay outside Git. Another team member reviews before Main merge.
