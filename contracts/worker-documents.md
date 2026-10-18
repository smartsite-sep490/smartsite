# Worker onboarding documents (MF01)

Web and Mobile Contractor Representatives collect the Worker's 12-digit citizen ID,
gender, address, phone number, front/back ID images and three documents: Group 3 occupational safety card, health certificate,
and personal insurance. Documents accept JPEG/PNG/PDF, at most 5 MiB each, with protected
authenticated viewing. Citizen IDs, phone numbers and documents are excluded from
general worker directory responses and application logs. Web selects existing images/files only.
Mobile supports camera, photo library and file selection for every document. ID sides accept
JPEG/PNG only. Each certificate accepts JPEG/PNG or a PDF of at most four pages.

All selected/captured files pass authenticated image-quality checks before selection and
are checked again before persistence. Unavailable quality service fails closed. OCR image
checks cover resolution, lighting and focus; they do not establish document authenticity.
New accounts require both ID images before Safety approval; originals remain available to
the reviewer through protected endpoints. Mobile removes its document cache copies on
replacement/unmount and immediately rejects/removes unreadable captures.

New documents enter PENDING. Only a Safety Officer assigned to the same Site can approve
or reject them. Representatives may optionally submit a real calendar expiry date for the
safety card and insurance (`submittedExpiresOn`). Health certificates instead accept the
examination/issue date (`submittedIssuedOn`); the application derives expiry as one calendar
year later, clamping a 29 February anniversary to 28 February. Dates can be supplied on account
creation or replacement upload and corrected or cleared while PENDING. Both suggestions are
stored separately from OCR and approved dates, appear to Worker/Representative/Safety, and
survive OCR retries. Safety's fields prefer the Representative suggestion, then OCR, and still
require explicit original/date confirmation. Manual input never activates a Worker or extends
a previous approval. Corrections increment the version, so a stale review returns 409.

The reviewer inspects the original and confirms/corrects issue and expiry dates. For health
certificates only the examination/issue date is editable; Backend computes the one-year expiry
and rejects a conflicting submitted expiry. Printed OCR expiry is ignored for this product rule.
Existing approved health dates remain unchanged until a new Safety approval; migration never
silently extends an approval.
OCR suggestions never approve documents or activate Workers. If OCR cannot determine a
date, the officer must enter it from the original; no expiry is invented from a filename
or an unrelated date. All three approved documents must be currently valid before the
Worker is eligible to enter. Expiry dates are inclusive in Asia/Ho_Chi_Minh.

Replacement uploads retain the currently approved document until a replacement is
approved. A rejected/pending replacement never extends the previous expiry. Approval
supersedes the old approved version, with review/version/audit history retained.
Concurrent/stale reviews return 409. Manual suspension remains independent from document
eligibility; approving documents must not undo a manual suspension. Exit recording
remains allowed for an established identity even after expiry.

Citizen ID checks are advisory. The Backend compares OCR suggestions from both ID images
and all three document types with the private profile's citizen ID. Worker, Representative
and Safety views show a mismatch warning with the reference and detected values. A mismatch
never blocks submission, Safety approval, renewal or eligibility after otherwise valid
approvals. Missing/ambiguous extraction and an absent profile reference remain distinct
from a confirmed match. No public Worker directory or notification exposes these numbers.
Apply `WorkerDocumentIdentityChecks1792627200000` after `WorkerDocuments1792540800000`
to store the reproducible OCR result for ID images; older images can be rescanned.

Workers may sign in and read their records, documents and notifications while suspended.
Creating shift/leave/overtime/correction requests, accepting or declining swaps and issuing
an entry QR require current approved documents. Recording departure and issuing an exit QR
remain available. Manual account/Worker suspension stays separate from document eligibility;
the roster exposes `documentStatus` so a pending/expired Worker is not shown as operational.
All Workers, including existing Workers with no compliance profile, require three valid
approved documents. New Representative-created accounts also require the full identity
profile and two ID images; historical Workers can submit the three documents for review.
The expiry job runs on Backend startup and hourly, with idempotent in-app notifications
to the Worker, scoped Representatives and Site Safety Officers. The default advance
notice is 30 days (`WORKER_DOCUMENT_NOTICE_DAYS`, 1–365). Entry checks expiry at request time.
There is no automatic extension from an uploaded file, OCR date, or a pending review.

Endpoints under `/api/v1`:

- `POST /sites/:siteId/contractors/:contractorId/document-image-quality`: Representative,
  multipart `file`; returns `ACCEPTED|RETAKE|UNAVAILABLE` and a safe reason.
- `POST /sites/:siteId/workers/:workerId/identity-images/:FRONT|BACK`: Representative,
  quality-checked ID image; byte-identical retries reuse the existing image.
- `GET /sites/:siteId/workers/:workerId/identity-images/:id/file`: protected ID original.
- `GET /sites/:siteId/workers/:workerId/compliance`: own Worker, scoped Representative,
  or Site Safety Officer; full document and profile state.
- `GET /sites/:siteId/worker-compliance`: paged Safety review queue or Representative roster.
  `search` (up to 120 characters) and `pendingOnly=true|false` are scoped and applied before
  pagination; the legacy pending filter includes incomplete/expired and newly submitted renewals.
  `submissionStatus=NOT_SUBMITTED|PENDING_REVIEW|REVIEWED` filters submission independently
  of operational eligibility. No certificate history means NOT_SUBMITTED; any pending certificate
  means PENDING_REVIEW; otherwise a previously submitted profile is REVIEWED.
  `needsSupplement=true|false` is a separate combinable filter/tag. It flags missing required identity,
  or a document kind with no pending replacement and either no current valid approval or a latest
  rejected submission. A partial submission can be both awaiting review and need more documents.
  A complete pending renewal does not require another upload. These tags never grant access.
- `POST /sites/:siteId/workers/:workerId/documents/:kind`: Representative multipart `file`;
  optional `submittedIssuedOn` for health or `submittedExpiresOn` for safety/insurance, in
  `YYYY-MM-DD` format. A date field for the wrong document kind is rejected. Runs bounded OCR and persists
  a pending version. Unknown fields and impossible calendar dates are rejected. Byte-identical
  retries preserve the original; an explicitly changed proposed date increments its version.
- `PATCH /sites/:siteId/workers/:workerId/documents/:id/submitted-expiry`: scoped Representative,
  `{expectedVersion, submittedIssuedOn: 'YYYY-MM-DD'|null}` for health or
  `{expectedVersion, submittedExpiresOn: 'YYYY-MM-DD'|null}` for safety/insurance;
  pending documents only. No file
  re-upload is required. Approved history cannot be edited through this endpoint.
- `GET /sites/:siteId/workers/:workerId/documents/:id/file`: protected original.
- `POST /sites/:siteId/workers/:workerId/documents/:id/ocr`: authorized Safety/Representative retry.
- `POST /sites/:siteId/workers/:workerId/identity-images/:id/ocr`: authorized Safety/Representative
  retry of citizen ID extraction on the protected original.
- `POST /sites/:siteId/workers/:workerId/documents/:id/reviews`: Safety Officer,
  `{expectedVersion, approve, issuedOn?, expiresOn?, reviewNote}`. A health approval requires
  `issuedOn`; `expiresOn` can be omitted and, when supplied, must equal the computed anniversary.

OCR is a Backend-owned local technical adapter. NestJS sends bounded original bytes through
stdin to the packaged Python helper, which invokes Tesseract/Poppler without a shell.
The helper returns `{status: 'READ'|'UNREADABLE'|'UNAVAILABLE', issuedOn: 'YYYY-MM-DD'|null,
expiresOn: 'YYYY-MM-DD'|null, nationalIds: string[], warnings: string[]}`. `nationalIds`
contains up to five labeled 12-digit suggestions, preserving leading zeroes, and is optional
for compatibility with stored older OCR results. Child output is bounded to 8 KiB; raw OCR
text is not returned or persisted. OCR failures preserve review availability; quality failures
still reject uploads. The child does not receive database credentials, account tokens or AI
service credentials. Document data stays in a private temporary folder removed after each run.

There is no document OCR HTTP service, port, AI-repository dependency or service token.
On a new local machine, install Python 3.11+ and Tesseract with Vietnamese/English language
data, plus Poppler (`pdfinfo` beside `pdftoppm`). Set `WORKER_DOCUMENT_TESSERACT` and
`WORKER_DOCUMENT_PDFTOPPM` in `apps/backend/.env` if the tools are not on PATH. Then run
`pnpm ocr:setup` once, optionally `pnpm ocr:setup --python <python-executable>`.
Setup creates `apps/backend/ocr/.venv`, installs pinned Pillow and writes the three local
executable settings, including `WORKER_DOCUMENT_PYTHON`, to the private Backend env file.
Remove the retired `SMARTSITE_DOCUMENT_OCR_URL` setting; setup removes it automatically.
Start only `pnpm dev:api` (or `pnpm dev` for Web + BE). No extra `pnpm dev:ocr` terminal is
needed. The deployed Backend image includes Python/Pillow/Tesseract/Poppler and language data.

Run `pnpm test:ocr` for synthetic parser, image-quality and private CLI boundary tests.
Backend tests separately cover child failure, private input/environment, response bounds,
serialization and cleanup. One CPU lane runs at a time per Backend process, with a 60-second
outer timeout and individual engine timeouts; busy/unavailable engines return unavailable for
retry. No runtime installation, OpenAI requests, GPU initialization or model downloads occur.
Missing/unlabeled dates require officer confirmation. Health expiry follows the explicit
one-year product rule above; no legal validity period is inferred for the other document kinds.

Template references supplied for this feature: [Group 3 safety card](https://vienxaydung.edu.vn/mau-chung-chi-an-toan-nhom-3/)
and [adult health examination form](https://thuvienphapluat.vn/phap-luat/ho-tro-phap-luat/mau-giay-kham-suc-khoe-dung-cho-nguoi-tu-du-18-tuoi-tro-len-moi-nhat-nam-2024-theo-thong-tu-so-3220-135567.html).

The helper and its tests ship with the Backend; camera/face AI remains in `smartsite-ai`.

Apply `WorkerDocumentSubmittedExpiry1792713600000` after the identity OCR migration. Existing
rows receive null and retain their approved dates. Rollback refuses to discard submitted values.
Then apply `WorkerHealthIssueDate1792800000000` to store optional examination/issue dates.
Existing approvals and their expiry dates are preserved; rollback refuses to discard these values.
