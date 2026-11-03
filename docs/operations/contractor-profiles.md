# Contractor and Representative profile management

Site Manager **Contractors & Zones → Create Representative** can select an existing Contractor or choose **Add a new contractor**. The latter creates the Contractor, its Site participation, Representative account, Site role and Contractor links in one PostgreSQL transaction. A duplicate username returns 409 and rolls everything back; a retry does not create a second Contractor. No migration or new table is required.

The new Contractor form takes a name and participation start date, plus an optional inclusive end date. It uses the same browser-local date conversion as the participation form. Registration retains the existing requirement for participation to be effective now: future starts and already-ended intervals cannot provision the Representative.

Examples (all paths under `/api/v1`, authenticated with the assigned Site Manager):

```http
POST /sites/:siteId/contractor-representative-accounts
{"contractorName":"Synthetic contractor","username":"synthetic.rep","displayName":"Synthetic representative","temporaryPassword":"SyntheticOnly123!","validFrom":"2026-01-01T00:00:00Z","validUntil":null}

PATCH /sites/:siteId/contractors/:contractorId/name
{"name":"Corrected contractor","expectedName":"Synthetic contractor"}

PATCH /sites/:siteId/representative-accounts/:userId/name
{"name":"Corrected representative","expectedName":"Synthetic representative"}
```

Creation returns the existing safe Account response. Rename returns `{id,name}`; Representative rename affects `displayName` only. These APIs are additive and the existing creation/assignment endpoints remain compatible. Deploy Backend before Web. Shared commands live in `contracts/src/management-api.ts` and the shared client exposes `createContractorRepresentative`, `renameContractor` and `renameSiteRepresentative`.

Edits require a profile belonging exclusively to the selected Site. Contractor participation in any other Site, or Representative role/assignment in another Site (including a global role), blocks Manager edits. Such profiles require administrative handling; these endpoints do not add an Admin bypass. Missing/cross-profile scope returns 404, unavailable Site role returns 403, malformed/unknown input returns 400, and shared or stale profiles return 409. Name edits preserve IDs, credentials, assignments and history and log actor, Site and resource identifiers without submitted account data.
