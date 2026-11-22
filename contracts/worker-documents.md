# Worker documents and Safety review (MF01)

Contractor Representatives own initial collection, supplements and renewals. Workers read their
own profile, originals, review state and notifications. Only Safety assigned to the same Site
can approve or reject individual certificates. OCR and AI results are advisory.

## Submit a document bundle

POST /api/v1/sites/:siteId/workers/:workerId/document-submissions accepts authenticated multipart
with one JSON metadata field and up to five files. Allowed file fields are FRONT, BACK,
SAFETY_CARD, HEALTH_CERTIFICATE and PERSONAL_INSURANCE.

Example metadata for an existing Worker with complete identity evidence:

    {
      "requestId": "55555555-5555-4555-8555-555555555555",
      "expectedVersion": 1,
      "safetyCardRequired": false,
      "documents": {
        "HEALTH_CERTIFICATE": { "submittedIssuedOn": "2026-11-01" },
        "PERSONAL_INSURANCE": { "submittedExpiresOn": "2027-11-01" }
      }
    }

Attach files named HEALTH_CERTIFICATE and PERSONAL_INSURANCE for this example.
Optional identity metadata contains nationalId (12 digits), phoneNumber, gender and address.
CCCD sides accept JPEG/PNG, certificates accept JPEG/PNG/PDF, at most 5 MiB per file.
PDFs may have at most four pages. Backend validates file signatures and decodability.
Unknown fields, wrong date fields, missing dates and impossible dates are rejected.

Initial collection includes both required ID images, health, labor insurance, and safety card
when declared required. Supplements include replacements and any missing required documents,
reusing unchanged pending documents or valid approvals.

The receipt contains requestId, version and documentIds. Exact retries reuse the existing
audit receipt before OCR/storage. Changed payloads with the same request ID or stale versions
return 409. Worker locking serializes submission and review. Storage happens before a short
database transaction. New unused files are cleaned after failure or deduplication. Existing
certificate revisions and protected references to replaced ID originals remain in history/audit.

Account creation keeps its existing endpoint. If submission fails after account creation,
complete the same Worker instead of creating another account. Upgrade Web/Mobile together with
this backend before permitting document writes. Individual certificate/identity upload and
submitted-expiry mutation endpoints/client methods are retired.

## Required documents and review

Representatives explicitly declare whether a Group 3 safety card is required. This declaration
takes effect immediately. Health and labor insurance remain required. Old profiles and
Workers without a profile default to requiring the safety card. The PERSONAL_INSURANCE
enum and stored historical data remain unchanged while the interface calls it labor insurance.

Profile responses include version and safetyCardRequired. Approved, current required documents
determine eligibility across gate, scheduling, queue filters, missing-kind labels and reminders.
Missing required identity or manual suspension still denies operational permission.
Uploading, OCR, AI and proposed dates never approve documents or extend an existing approval.

Safety confirms issue/examination and expiry against the original. Health expiry remains one
calendar year after the confirmed examination date, clamping 29 February to 28 February.
Expiry is inclusive in Asia/Ho_Chi_Minh. A valid approved original continues during a pending or
rejected renewal until its replacement is approved or the original expires.

Rejection requires a note, retains history and notifies the Representative to submit corrections.
Identity corrections and replacement ID images are version checked and audited. Existing
approved certificates retain their status until Safety approves a replacement.

## OCR preflight

These authenticated preflight endpoints remain available:

- POST /sites/:siteId/contractors/:contractorId/document-image-quality
- POST /sites/:siteId/workers/:workerId/document-image-quality
- POST /sites/:siteId/workers/:workerId/documents/:kind/check

The quality response includes optional OCR evidence. Certificate checks return quality, ocr
and dateCheck without persistence. Scoped Representatives may preflight. Workers cannot
preflight or write documents.

Combined helper inspection checks quality and reads text once, sharing rendered PDF pages.
PDF pages with useful native text use that extraction first, with OCR for the other pages.
Changing only a date compares it with the existing OCR result instead of uploading again.

The backend keeps at most 64 cached results for five minutes per instance, keyed by actor,
Site, Contractor, media type, original hash and processing revision. Only evidence/metadata
is cached. A cache miss safely recomputes. Originals remain protected and unchanged.

Malformed, corrupt, oversized and excessive-page files are rejected. Blur, exposure issues,
unreadable text, expiry and field mismatches are advisory and may be sent for human review.
Unavailable mandatory file validation requires retry. OCR availability never establishes
identity, document authenticity or permission.

Keep WORKER_DOCUMENT_PYTHON, WORKER_DOCUMENT_TESSERACT, WORKER_DOCUMENT_PDFTOPPM,
pnpm ocr:setup and pnpm test:ocr. The Backend owns the bounded helper, uses no separate HTTP
service and passes no application secrets to child processes.

## On-demand Safety AI scan

Safety selects profiles on the current queue page and presses Quick AI scan. Changing Site,
filters or page clears selection. The screen previews profile/document counts, scans pending
documents sequentially, and reuses COMPLETE results. Stop prevents the next request.
Leaving the screen stops future requests while persisted results remain available.

POST /sites/:siteId/workers/:workerId/documents/:id/ai-analysis reads the protected stored
original and returns 204 after saving evidence. Only scoped Safety can call it.
Concurrent claims and stale attempts are fenced by a lease. Opening originals never invokes AI.
Reviewed documents cannot start a new analysis.

The backend uses OpenAI Responses API structured outputs with store:false. OPENAI_API_KEY
remains server-side. WORKER_DOCUMENT_OPENAI_MODEL defaults to gpt-4.1-mini.
WORKER_DOCUMENT_OPENAI_TIMEOUT_MS defaults to 30000. The default client waits at most 40000 ms.
No automatic client retry occurs. Safety can request another scan after failure.

aiSummary on the Safety queue considers current pending documents only and prioritizes
discrepancies while retaining unresolved counts. Statuses are NOT_SCANNED, ANALYZING,
ATTENTION, NO_DISCREPANCY and INSUFFICIENT. Detail includes persisted extraction plus
computed date, identity, type and validity comparisons. A favorable label is still pending
human review. Provider failure never prevents original viewing or manual Safety review.

Representatives and Workers do not receive AI extractions. Public directories and logs
exclude citizen IDs and evidence. There is no automatic AI on upload, Cloud Tasks,
Scheduler or AI-job table. Existing approved-expiry notifications retain their hourly sweep,
defaulting to 30 days advance notice and applying the declared safety-card requirement.

## Migration and verification

Apply WorkerDocumentReviewWorkflow1795478400000 before this backend, after existing
WorkerDocumentAiAnalysis1795132800001. It adds safety_card_required (default true) and version
(default 1) to worker_compliance_profile. Synchronization and startup migrations stay disabled.

Run focused backend/client/Web/Mobile tests, PostgreSQL migrations and integration tests,
repository checks and OCR tests. Automated provider tests mock OpenAI and use synthetic files.
