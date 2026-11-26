# MF01 Worker onboarding

Representatives use **Worker intake** to prepare multiple account drafts for the same Site and
Contractor. The draft stores the display name, username, email, language, Group 3 safety card
requirement, declared document dates and private certificate attachments. Incomplete rows may be
saved. Provisioning requires all login details, an explicit Group 3 declaration, a health
certificate and labor insurance, plus a Group 3 card when required. The document date must be
filled in for each attached certificate.

## Representative commands

All routes are relative to `/api/v1`.

| Method and route                                                                                 | Behavior                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sites/:siteId/contractor-worker-account-options`                                           | Lists Contractors the Representative is allowed to manage at the Site.                                                                         |
| `GET /sites/:siteId/contractors/:contractorId/worker-onboarding-drafts`                          | Returns intake rows and their linked Worker/document status.                                                                                   |
| `PUT /sites/:siteId/contractors/:contractorId/worker-onboarding-drafts/:id`                      | Saves a client-generated UUID with multipart metadata and optional files. Version 0 creates a draft. Later writes require the current version. |
| `GET /sites/:siteId/contractors/:contractorId/worker-onboarding-drafts/:id/documents/:kind/file` | Reads a protected original from an unprovisioned draft.                                                                                        |
| `POST /sites/:siteId/contractors/:contractorId/worker-onboarding-drafts/provision`               | Accepts `{ items: [{ id, version }] }` with up to 50 unique intake rows.                                                                       |
| `PUT /sites/:siteId/contractors/:contractorId/workers/:workerId`                                 | Updates the Worker name or active status using the expected snapshot.                                                                          |

The provisioning response contains `items` with the input ID, `SUCCEEDED` plus a Worker ID, or
`FAILED` with a public error. Each row commits independently. The Backend creates the Worker-only
account, generates its code, attaches the prepared certificates in draft status, and queues the
welcome email in one transaction. Successful requests can replay the original draft version without
adding an account, certificate or email. A stale draft edit or a duplicate account identifier returns
a conflict. Passwords and storage keys are excluded from responses.

Linked workers and existing records are managed under **Manage worker records**. The Representative can
suspend or restore a Worker without changing their login account. Web also provides the supervised
face enrollment workflow with Worker consent. Mobile shows current face status. Eligibility requires
current approval and the existing operational policies. See [Worker documents](worker-documents.md)
for sending certificates to Safety and personal identity updates.
