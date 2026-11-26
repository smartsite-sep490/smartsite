# Worker documents and Safety review (MF01)

Representatives own certificates, including replacements and renewals. Workers update and read
their own personal information. A scoped Representative or Safety Officer can view personal
information and protected originals. Identity completion is separate from certificate approval,
gate access, scheduling and attendance.

## Draft certificates and batch submission

All routes are relative to `/api/v1`. Representative writes require an active Contractor grant
and valid Site participation for the selected Worker.

- `POST /sites/:siteId/workers/:workerId/document-submissions` saves certificate drafts. The
  multipart `metadata` includes `requestId`, `expectedVersion`, `safetyCardRequired` and
  `documents`. File fields have certificate kind names. An existing draft can be updated with new
  date metadata and its original file. Matching retries return the same receipt.
- `POST /sites/:siteId/contractors/:contractorId/worker-document-submissions/batch` accepts
  `{ items: [{ id, version }] }` with up to 50 unique Worker IDs and their compliance versions.
  It returns success or a public error per Worker. An exact successful retry does not create a
  second review or notification.
- `GET /sites/:siteId/workers/:workerId/compliance` shows the certificate versions and status
  available to the caller. Unsent drafts are scoped to the Representative. The Safety review
  list surfaces submitted and reviewed records in the authorized Site.

Sending a Worker requires at least one draft and coverage of all required certificate kinds
through a draft, pending certificate or valid approved original. The proposed Group 3 card
requirement takes effect on submission. Safety reviews the pending version using the original.
Representatives declare the examination date for health certificates, and can declare the issue
date for Group 3 cards or the start of coverage for labor insurance in addition to the expiry
date. Safety can approve using the declared dates after reviewing the original, or supply corrected
or missing dates. A reason is required when returning a certificate. Approved originals remain
effective through their inclusive expiry date in Asia/Ho_Chi_Minh or until a replacement is
approved. Health certificate expiry is one calendar year after the examination date, with 29
February clamped to 28 February. Pending or rejected renewals preserve the current approval.

## Worker self-service identity

`GET /sites/:siteId/workers/me/compliance` finds the Worker linked to the login without
requiring an active team assignment or contractor participation.

`PUT /sites/:siteId/workers/me/identity` takes multipart metadata with `expectedVersion`,
`nationalId`, `phoneNumber`, `gender` and `address`, plus the `FRONT` and `BACK` file fields.
Both sides are required for the first completed setup. Later changes can reuse a stored side.
The Backend derives the Worker from the signed-in account and serializes concurrent updates.
Personal fields and images are available through scoped, protected reads.

## File validation and optional AI

CCCD accepts JPEG/PNG. Certificates also accept PDF, with at most four pages. All files are
limited to 5 MiB and validated before storage. Native Backend development requires Poppler
`pdfinfo` and `pdftoppm` on PATH. The Backend image includes the tools. OCR evidence and its
historical database columns remain available for data retention only.

`POST /sites/:siteId/workers/:workerId/documents/:id/ai-analysis` requests advisory analysis of
a stored draft certificate. The scoped Representative may request it and read its result. The
analysis uses the existing server-side model configuration. The result is specific to that
certificate version and its declared dates. AI checks the document type, dates and validity.
Personal identifiers are excluded from the result. Citizen ID photos are never sent for analysis.
Safety makes the review decision from the original. Provider failure records an unavailable
result and returns HTTP 503 while keeping manual submission and review available.

## Migration and verification

Apply `WorkerOnboardingBatch1795737600000` after the existing document-review migrations.
Deploy the Backend, Web and Mobile clients together for the changed write flow. Test the
migration on existing approved and pending certificates. Verify permissions, independent
batch results and retries on PostgreSQL. AI and email verification tests use synthetic inputs.
