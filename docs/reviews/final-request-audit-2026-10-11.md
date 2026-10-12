# Final audit of the requested attendance and scheduling changes

Reviewed current source, previous acceptance reports, application schema, running containers and fresh regression results on 2026-10-11.

| Request                                                                                                          | Result                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Site Manager configures an unpaid shift break; only overlap with presence is subtracted                          | Implemented; shift/attendance snapshots and overlap tests pass                                          |
| Today's OUT must not close yesterday's missing checkout; preserve running overnight shifts                       | Implemented; PostgreSQL regressions pass                                                                |
| IN without an assigned shift is denied and the worker receives a missing-schedule notification                   | Implemented across shared Face/QR/manual policy; deduplication and confirmation revalidation tests pass |
| Gate Desk keeps Access Denied, shows the requested English message, hides NO_SCHEDULE and generic policy wording | Implemented; current Gate Desk/helper regressions pass                                                  |
| Only one pending correction per worker/site; submit again after review                                           | Implemented at Backend and Web, across day filters and concurrent requests                              |
| Contractor sees recorded/proposed intervals; only rejection prompts for a required reason                        | Implemented; approval without a note and rejection validation tests pass                                |
| Team/individual daily, weekly and finite recurring assignment with preview/conflicts                             | Implemented; atomic creation, scoped authorization and retry/concurrency tests pass                     |
| Individual exceptions, explicit assignment to new team members, day/from-date changes and cancellations          | Implemented per assignment batch; existing attendance and started shifts protected                      |

Fresh verification:

- Frozen installation, peer checks and Mobile dependency checks passed.
- `pnpm check` passed: lint, type checks, unit/Web/client/contract/script tests and builds. Backend 283, Web 394, API client 47, contracts 80, scripts 23.
- Full dedicated PostgreSQL integration suite passed: 126 tests.
- Focused attendance, Gate Desk, shift-break and team-assignment Web regressions passed: 46 tests across six files.
- Initial focused Web verification found outdated exact-label assertions after UI wording changes. Team-option assertions now use the accessible option name, status assertions tolerate explanatory text, and browser location is reset between tests. Decorative arrow/check spans are hidden from accessible button names. Fresh focused and full suites passed after the repairs; business policy was not changed.
- Runtime migration history contains ShiftBreak1791763200001, GateScheduleDenial1791849600000 and ScheduleAssignmentBatches1791849600001.
- Runtime attendance/cross-day/access-policy compiled files matched local build bytes. The initial team-assignment build difference was only formatting; no policy difference was found.
- Backend/Web rebuilt and restarted after the audit fixes. Both are healthy and readiness endpoints returned HTTP 200. Changed-file formatting and Git whitespace checks passed.

Remaining acceptance limits:

- Authenticated real-browser and physical Face/QR passage acceptance, plus another team member's review, are still required for final operational sign-off.
- Historical incorrectly matched OUT events and old duplicate correction requests were not automatically rewritten or deleted. They require the existing reviewed reconciliation workflow.
- Existing shifts without a configured break retain their old configuration; no fixed one-hour deduction was applied to them.
- Recurrence has an explicit end date. Team membership propagation is an explicit previewed action, and edits/cancellations apply to selected assignment batches.

No production deployment, commit or PR was performed; this is the updated local Compose runtime.
