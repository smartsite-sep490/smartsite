# Team Zone assignment

The Contractor Representative Dashboard has **Assign Zone** on each active team's row. Its dialog lists only unrevoked Contractor Zone grants belonging to the selected Site/Contractor and not yet expired. Representatives choose a grant and inclusive start/end dates. Each team has at most one unrevoked Zone assignment, including a future or expired assignment. Assigned rows display the Zone and **Edit Zone**. Unassigned teams remain usable for organizing Workers but provide no inherited Zone permission.

Both the Site Manager Contractor Zone form and this dialog use the shared calendar with fixed `dd/MM/yyyy` display, independent of Windows/browser date formatting. API values remain `YYYY-MM-DD`. Backend resolves local midnight through the supplied IANA timezone and intersects the selected day range with the Contractor Zone grant and participation. No-overlap ranges fail with 409. A parent starting mid-day never grants earlier access.

## Additive API

Base path: `/api/v1/sites/:siteId/contractors/:contractorId/teams/:teamId/zones`.

- GET returns `availableZones` (parent permission ID, Zone ID/name and UTC interval) and the team's `permissions` (Zone, interval, revocation and current effectiveness).
- POST accepts the example below and returns `{ "id": "..." }`.
- POST `/:permissionId/revoke` revokes that team's permission idempotently.

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "contractorZonePermissionId": "00000000-0000-4000-8000-000000000002",
  "startDate": "2026-10-12",
  "endDate": "2026-10-13",
  "timezone": "Asia/Ho_Chi_Minh"
}
```

All operations recheck the active account, persisted Representative role, Contractor representative assignment and active participation. Admin/Site Manager roles do not bypass that requirement. A team and parent grant must belong to the same Site/Contractor and the parent Zone must belong to that Site. Grant requires an active team and an unrevoked parent. Date validation rejects timestamps, invalid dates, reversed ranges and invalid timezone. Creation retains actor/team/parent/resolved-interval idempotency; retry uses the same request ID, while conflicting reuse returns 409. Revocation is audited, as is creation. No external calls occur in these transactions.

## Authorization behavior

For a verified active Worker, Backend Zone-entry authorization also checks membership in the configured team at the event timestamp, an active team, bounded Team/Contractor/participation intervals and their revocations. The Worker must still have an **approved Site/Zone assignment covering this Zone and event time**. Team configuration does not approve Site access, issue gate passes, create schedules or authorize unknown identities. Explicit Worker deny rules remain authoritative.

Workers joining a team receive inherited permission only once membership starts and their Site/Zone approval is effective. Leaving/transferring removes the old team's permission for later events. Parent expiration/revocation invalidates descendants without copying grants to each Worker. Existing direct Worker permissions remain independent. Revocation timestamps preserve evaluation of older observations; they deny events on/after revocation. Archived teams fail closed. GET effectiveness reports current state rather than historical attendance.

## Deployment and rollback

Apply `ContractorZoneRegrant1791940000001` before allowing regrants. Contractor Zone uniqueness applies only to unrevoked grants with the same participation, Zone and start instant. A new request can regrant a revoked interval, retaining the old permission and audit history. Retrying the original request still returns its revoked record. Team/Worker grants referencing that record remain revoked through their parent; representatives must explicitly assign the new parent grant. Concurrent duplicate unrevoked grants still return 409. This changes no API payloads. Downgrade refuses if regrant history would prevent restoring the old unique index; roll back application images while retaining this compatible index instead of deleting history.

Apply `TeamZonePermissions1791940000000` **before** the Backend/Web images. It adds `team_zone_permission`, explicit FKs, an interval check, lookup index and a trigger rejecting cross-Site/Contractor/Zone parents and out-of-parent intervals. Existing permissions/data remain unchanged. Backend must not use schema synchronization. Rollback drops an empty new table only; a populated table requires an explicit preservation plan and the migration refuses to erase it. Roll back application images first if necessary; retaining the additive table is safe for the prior application.

Shared types are in `contractor-team-api.ts`; the existing Contractor/Worker permission APIs and AI observation contract remain compatible. Coverage includes PostgreSQL constraint/authorization tests, parent revocation, missing membership/approval, explicit deny, idempotency, date bounds, UI retry/error/empty states and encoded client paths. Run repository gates and the PostgreSQL integration suite before deployment.

Apply `SingleTeamZone1791940000002` before this Backend/Web version. It adds a partial unique index on team ID for unrevoked assignments. Legacy teams with multiple unrevoked assignments must be explicitly resolved; migration never deletes history. Downgrade removes only the index. POST creation rejects a second assignment with 409. PATCH `/:permissionId` accepts the same date/grant command and atomically revokes the expected old permission and creates a replacement; concurrent stale edits fail with 409, identical request retries return the replacement. History and audits remain intact. Existing members inherit the replacement only within its interval and approved Site/Zone access. Team responses add `zoneAssignments`; the Worker-scoped my-team response adds `zones`. The Worker profile card displays team and assigned Zone; inactive configuration is labeled and is not access authorization.
