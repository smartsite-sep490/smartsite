# Contractor Web / Mobile parity

Scope confirmed on 20 November 2026: Contractor Representatives use both Web and Mobile. Worker operations are deployed on Mobile; this change does not add a second Worker Web experience or remove existing compatible routes.

Both Contractor clients use the shared API client and Backend scope, validation and financial rules. Their controls use platform-appropriate layouts. A gate entry alone does not prove presence at the assigned work zone.

| Capability                            | Web entry point                                               | Mobile equivalent / shared behavior                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker account and profile            | Worker Onboarding                                             | Workforce: create account, normalized email, identity/profile fields, document completion and existing profile edits                                             |
| Account email                         | My account in the header                                      | Profile: update requires current password, verify/resend with cooldown; only verified email supports recovery                                                    |
| Password recovery                     | Login → Reset password                                        | Login → Forgot password: generic request result, one-time code, new password; Backend revokes old sessions                                                       |
| Groups and leader                     | Contractor Teams → team name / Team details                   | Groups → details: add, transfer, remove and appoint/remove leader; choose the action before choosing the worker                                                  |
| Group zones                           | Team details → Work zones, or existing row shortcut           | Group zones: grant, replace effective period and explicitly confirm revocation of the selected permission                                                        |
| Group calendar                        | Schedule → Team calendar                                      | Calendar: week/month, group filter, team/shift/day aggregation; no individual Worker calendar rows in the Contractor calendar                                    |
| Zone roll call readout                | Select a calendar day and group shift                         | Daily calendar sheet: present/absent/not-yet, actual zone, gate comparison, paginated members and totals                                                         |
| Schedule lifecycle                    | Calendar → Assign and manage schedules                        | Assign/manage batch: preview then commit, change/cancel scope, optimistic version, stable retry ID and reason; started/attendance schedules protected by Backend |
| Attendance / reports                  | Calendar → Attendance, or existing Attendance workspace       | Attendance history: scoped workers, dates, provisional versus confirmed totals, day details and report export                                                    |
| Attendance decisions                  | Day details and existing Attendance workspace                 | Approve/reject corrections, ignore duplicate with reason/version, acknowledge eligible early checkout with reason/version; respect returned Backend capabilities |
| Documents / certificates              | Worker Documents → View / Submit or supplement                | Compact library: identity sides and certificate sections, file viewing, quality/date checks, pending submissions and approved originals, renewals and history    |
| Shift changes, swaps, leave, overtime | Existing Workforce request review and Attendance request tabs | Existing Contractor request review: Backend owns eligibility, invitations, decisions and schedule reconciliation                                                 |
| Assigned safety work                  | Assigned Work                                                 | Assigned checklist and corrective-action evidence/submission; review remains with Safety staff                                                                   |
| Notifications                         | Header inbox                                                  | In-app inbox: read/delete and polling; shared notification visibility rules                                                                                      |
| Language                              | Header language picker                                        | Vietnamese/English; authored names and reasons remain unchanged                                                                                                  |

## Data and authority

- Worker zone dispatch/access is available from Contractor Dashboard → Worker zone access. It uses `accessSetup`, `createWorkerSiteZoneAssignment`, `grantWorkerZone` and `revokeZonePermission`. The view filters by selected Contractor, retains pending assignments without a participation pointer, respects the returned worker-grant capability and hides staff approval/Contractor-zone grant controls. Backend still authorizes every command; the existing staff Access workspace is unchanged.

- Worker creation now sends `email` and `language`. Backend generates a unique initial password, hashes that exact password and queues the welcome email transactionally. Web no longer displays the legacy default password. If a document upload fails after creation, retry completes the existing account rather than creating another one. `QUEUED` is not inbox delivery confirmation.
- Existing QR visitor Resend configuration is reused. No new provider, key, migration or email infrastructure was added for Web parity.
- Leader appointment updates the existing team leader pointer. Membership changes use the originally selected `membershipId`; leader changes use the originally opened team version. Refreshing data does not silently replace an in-flight command's concurrency snapshot.
- Contractor reads `contractorTeamAttendance`, scoped by Site, Contractor, team, work date, shift and schedule version. Contractor does not call the Worker-only `scheduleTeamAttendance` / `submitTeamAttendance` endpoints. The leader continues taking/correcting roll call on Mobile.
- Reconciliation, introduced in the preceding Mobile change, requires matching leader PRESENT plus a real gate-linked CHECK_IN for affected group shifts. Missing or mismatched evidence remains under review; old confirmed days are preserved. No Web control can bypass that rule.
- The calendar Attendance tab filters the day list by workers of its selected Contractor before pagination. Summary and export requests include the same Contractor, date and selected Worker filters.
- Safety document approval and Site/Zone/shift administration remain with their assigned roles. Contractor submission does not become document approval. Compact Contractor document viewing has separate submission controls; existing Safety/Worker panel defaults remain intact.
- Multiple Contractor scopes require an explicit selection. A temporary scope refresh failure preserves and disables the assignment draft; a denied scope removes the cached workspace. Selecting a different scope remounts the workspace and clears its drafts/modals.
- Accounts with additional Site Manager/Admin roles keep the management schedule workspace. The `view=contractor` link from team details explicitly opens their Contractor calendar with the selected Site/Contractor.

## Verification and platform limits

Focused Web tests cover email creation/retry, verified recovery UI, group leadership and membership snapshots, group-calendar scope/roster/day navigation, scoped attendance/export, review actions, zone revocation and compact document viewing/submission. Existing staff, request, batch and report suites are included in the affected checks. TypeScript, changed-file lint/format and catalog audits are checked separately.

`apps/web/e2e/contractor-parity.e2e.ts` drives the full Contractor workspace in Chromium in Vietnamese and English using intercepted synthetic API responses. It captures group roll call, day details, leader selection, zone revocation, document library and email verification, including a 1024px notebook viewport. These browser checks do not prove every live API/permission combination or real email delivery.

Verified on 20 November 2026:

- Affected Web regression run: 23 files, 225 tests passed.
- Final Worker access, Dashboard, existing Access policy and catalog checks: 4 files, 31 tests passed (includes repeated regression coverage).
- Shared account-email client request test: 1 passed.
- Full-workspace Contractor browser scenarios: Vietnamese and English, 2 passed; all API responses intercepted with synthetic fixtures. Worker zone access was included in the final run and visually inspected.
- Web TypeScript and changed-file ESLint passed. Owned files were formatted; scoped Git whitespace and source-integrity checks accompany the saved source snapshot.

No native app build, Docker environment or new production dependency is needed for this Web change. Actual inbox delivery and the preceding Backend PostgreSQL integration suites remain separate verification work. Native push is prepared in Mobile for a later native build and remains disabled; browser push is not introduced by this parity change. Both platforms retain their in-app notifications.

See [Mobile API inventory](mobile-api-inventory.vi.md) for API/CRUD/data prerequisites and [the Mobile audit](mobile-api-audit.vi.md) for Backend rollout and policy verification limits.
