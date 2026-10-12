# Site Manager management reads

The Web Site Manager Dashboard uses authenticated Backend reads scoped to the assigned Site. Admin and Contractor Representative roles do not bypass the Site Manager requirement. Reads recheck the active account and persisted Site role in a repeatable-read transaction. Unavailable authorization data cannot produce an overview.

## API and compatibility

These additive endpoints use response types exported from `@smartsite/contracts` and methods on `SmartSiteManagementClient`. No schema migration or AI contract change is needed.

- `GET /api/v1/sites/:siteId/management/overview?offset=0&limit=20`: active participating Contractor count, configured Zone count, active team and Worker totals, and a paginated Contractor list. Totals do not depend on the page. Expired, future and inactive participation and inactive Contractors are excluded. Workers and teams are counted only in this Site.
- `GET /api/v1/sites/:siteId/management/contractors/:contractorId?date=2026-10-12&timezone=Asia%2FHo_Chi_Minh`: Contractor detail with active teams and Worker counts, effective Contractor Zone grants overlapping the selected local day, and scheduled teams/shifts for the requested `work_date`.

Example overview (synthetic IDs shortened for readability):

```json
{
  "site": { "id": "site-id", "code": "DEMO", "name": "Demo Site" },
  "contractorCount": 1,
  "zoneCount": 2,
  "teamCount": 1,
  "workerCount": 4,
  "contractors": {
    "items": [
      {
        "id": "contractor-id",
        "code": "CTR-generated-uuid",
        "name": "Alpha",
        "teamCount": 1,
        "workerCount": 4
      }
    ],
    "total": 1
  }
}
```

Detail adds `date`, `timezone`, `teams`, `zones`, `scheduledTeams`, `scheduledWorkerCount` and `scheduledWorkersWithoutTeam`. Each scheduled team includes distinct active scheduled Workers and shifts with RFC 3339 `startsAt`/`endsAt` and template timezone. Multiple shifts do not double-count a Worker. Overnight shifts preserve their local day offset. Archived templates remain visible when an active schedule references them. Revoked grants and Zones belonging to another Site are excluded. Multiple effective intervals may appear for the same Zone.

Web defaults to the browser's local date and IANA timezone, displays both, and permits selecting another date. The selected date identifies the schedule's `work_date`; shift timezone determines actual start/end instants. Team grouping uses **current active membership**, matching schedule management. This is scheduled work, not attendance or a historical team roster. Active Workers without teams remain in `workerCount`; `scheduledWorkersWithoutTeam` makes their scheduled work explicit. Zone grants describe authorized work areas, not observed locations. A Contractor must currently participate in this Site to open its detail.

Missing/invalid date or timezone returns 400; missing authentication returns 401; unassigned Site/role or blocked account returns 403; a Contractor outside the active Site scope returns 404. Web loading, empty, error and retry states do not substitute zero for unavailable counts.

## Contractor Zone dates

The manager Zone assignment form accepts `Start date` and `End date` only, both inclusive. It calls the additive `POST /api/v1/sites/:siteId/access-setup/contractor-zone-permissions/dates` endpoint:

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "siteContractorId": "00000000-0000-4000-8000-000000000002",
  "zoneId": "00000000-0000-4000-8000-000000000003",
  "startDate": "2026-10-12",
  "endDate": "2026-10-13",
  "timezone": "Asia/Ho_Chi_Minh"
}
```

Backend validates real calendar dates and the IANA timezone, converts local midnight at the start date and midnight **after** the end date to UTC, then intersects the interval with Contractor participation. A same-day grant is valid. Dates wholly outside participation are rejected. This allows a Contractor added mid-day to receive permission starting at its participation time without granting earlier access. Daylight-saving days have their actual 23/25-hour duration. Permission storage and responses retain `validFrom`/exclusive `validUntil` instants; no schema change is required. The assignment list renders dates and displays the browser timezone. Audit metadata includes the requested dates and timezone. Existing exact-timestamp Contractor and Worker permission APIs remain compatible.

`requestId` retains existing actor/scope/interval idempotency. Retry uses the same ID; a changed resolved permission conflicts. Duplicate grants with different IDs and identical participation/Zone/start return 409 rather than a database error. The Web preserves the ID across a failed request and replaces it when the form changes.

## Automatic codes

Site Manager forms submit names/configuration without `code`. Backend scoped Contractor creation generates `CTR-<uppercase UUID>`; Zone creation generates `ZONE-<uppercase UUID>`. Existing uniqueness constraints remain authoritative. Existing codes are unchanged. Optional explicit codes remain supported for integration scripts and linking an existing Contractor by code/name to another Site. Empty/malformed explicit codes are rejected. Site codes retain their existing required input.

The client displays the returned generated code. Requests without an explicit code create a new record; integrations must not blindly replay a successful creation after losing its response. The UI disables duplicate submissions while pending.

Regression coverage includes PostgreSQL aggregation and scope tests, authenticated management HTTP tests, fail-closed unit tests, automatic-code form tests and Dashboard/detail interaction tests. Run repository quality gates and PostgreSQL integration tests before deployment.
