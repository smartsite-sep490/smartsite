# Mobile team Zone attendance (MF03/MF07)

## Behavior and acceptance criteria

- Contractor Representatives appoint or remove one current team member as leader from the Mobile team detail. The member needs an active Worker account. Transferring/removing the leader clears the appointment.
- Workers open a shift's daily calendar detail in a compact sheet. Their own Zone attendance is **Not yet**, **Present**, or **Absent**, translated into Vietnamese/English. Opening a calendar or entering the gate never automatically marks Zone attendance.
- Leaders open **Take team attendance / Update attendance** inside that same sheet. The roster contains only active current members with the same Site, Contractor, date, shift and schedule version. Only explicitly selected members are submitted; untouched members stay Not yet.
- The assigned Zone and shift context come from Backend. Attendance opens at the resolved shift start, including overnight shifts and the template timezone. A missing/ambiguous Zone or unavailable/denied API disables editing.
- Submitted attendance can be corrected with a reason of at least five characters. Each member has optimistic version and membership checks. The atomic submission records actor, timestamp, Zone, before/after values and correction reason in `audit_log`. Stable request IDs support retries without a duplicate submission audit.
- Finalized attendance days and records belonging to a previous membership are read only. This change does not add an approval flow for reopening finalized payroll.
- Ordinary Workers can read only their own scheduled attendance; they cannot fetch the roster or submit another Worker's attendance. Leadership is scoped, not a new global user role. Backend rechecks persisted account, role, membership, Contractor participation and leadership on every operation.

## Gate evidence

The Backend derives a read-only comparison with canonical gate-linked CHECK_IN evidence for the same worker schedule. `MATCHED` means gate entry plus Present; `NO_GATE_ENTRY` means Present needs gate review; `GATE_ONLY` means a gate entry has no corresponding Present confirmation; `NOT_YET` means neither is recorded. The Mobile sheet displays the comparison beside the confirmation.

Roll call attests to presence at the assigned Zone. It does not prove completed work, continuous presence throughout a shift or grant Zone access. Raw gate events stay immutable. For group-assigned shifts starting after the policy rollout, reconciliation requires matching team/membership/Zone, leader PRESENT and a gate-linked CHECK_IN before worked hours can be confirmed. Missing or mismatched evidence requires review. Approved full-shift leave and consistent absence do not create worked hours; previously confirmed days are preserved.

## Additive API

All routes use `/api/v1`, an authenticated user token and reviewed types in `contracts/src/team-attendance-api.ts`.

- `PUT /sites/:siteId/contractors/:contractorId/teams/:teamId/leader`: `{ expectedVersion, workerId }`, where null removes the appointment. Team responses add optional `leaderWorkerId`; `my-team` adds optional `isLeader`.
- `GET /sites/:siteId/worker-schedules/:scheduleId/zone-attendance`: own status and gate comparison, assigned team/Zone, `canManage`, `canSubmit`, plus the roster only for the current leader.
- `PUT` on the same attendance route: `{ requestId, teamId, zoneId, entries: [{ scheduleId, expectedMembershipId, expectedVersion, status }], reason? }`. Status is explicitly PRESENT or ABSENT. A new record expects version zero. A maximum of 500 distinct members can be submitted atomically.
- `GET /sites/:siteId/contractors/:contractorId/teams/:id/attendance`: scoped contractor roster and totals for `workDate`, `shiftId`, `scheduleVersionId`, with `offset`/`limit`. It is shown inside the contractor group calendar day sheet; it does not call the Worker-only roster API.

## Mobile documents

Both Contractor and Worker document entry points use a compact document library: profile summary, two identity sides, and three certificate rows. Detail sheets display files, dates, review notes and pending renewals alongside approved originals. Previous superseded versions remain available on demand. Submission controls appear only with the caller's existing upload capability; Worker identity originals remain read only. The upload path keeps image quality/date checks and Backend review requirements.

Date inputs use the shared calendar control, displayed using the selected UI locale. Image evidence opens in a separate full-screen viewer. Existing PDF sharing and authenticated file loading are preserved. All added labels, states and actions have matching Vietnamese/English catalog entries.

## Deployment and validation

Apply `TeamAttendance1795219200000` before this Backend and Mobile version. It adds the nullable leader pointer, `team_attendance`, explicit foreign keys/checks, a team lookup index and a trigger rejecting inconsistent Worker/Site/Contractor/Zone/membership references. Existing teams have no leader, and existing shifts remain Not yet. Schema synchronization stays disabled.

Deploy Backend before Mobile. Older clients ignore additive response fields. Roll back application images while retaining the additive schema. Migration downgrade refuses to erase populated team attendance history.

Focused tests cover ordinary Worker status refresh, leadership controls, explicit member choices, correction reasons, retained draft versions, retry/error states, document read/upload permissions, date rechecking and i18n parity. PostgreSQL integration coverage is provided in `team-attendance.integration.test.ts` for scoped leadership, immutable gate evidence, retries, correction history, finalized days, scope triggers and removal of leadership. Run it against the dedicated local test database before release.

The current work session avoids Docker and app builds after the user reported computer freezes. The team migration and three completion migrations have been applied to the configured runtime database; readiness returns 200 and roster/policy SQL is checked using operational EXPLAIN. This does not replace PostgreSQL integration tests, which still need the dedicated local test database. Native device visual QA, full workspace build checks and actual native push delivery have not been executed. See [the updated Mobile audit](mobile-api-audit.vi.md) for email recovery, review actions, batch scheduling and verification limits.
