# Workflow 01 follow-up

The review stack for `fix/workflow01` is based on Main `7665e74c`.

Review the dependent slices in order, then the Main integration PR:

1. [#319](https://github.com/smartsite-sep490/smartsite/pull/319): audit-path preflight.
2. [#320](https://github.com/smartsite-sep490/smartsite/pull/320): Mobile password,
   today's assignment and Contractor onboarding retries.
3. [#321](https://github.com/smartsite-sep490/smartsite/pull/321): Mobile team archival.
4. [#322](https://github.com/smartsite-sep490/smartsite/pull/322): Contractor Web
   document submissions and field validation.
5. [#323](https://github.com/smartsite-sep490/smartsite/pull/323): Safety document review.

Each review branch keeps its documented base. The `fix/workflow01` PR into Main
is the integration point; human review remains required before merging.

## Authority readiness on pooled connections

`hasMainAuthorityCapture` previously compared each stored journal function's pinned
`search_path` with the caller's session setting. A canonical function pinned to
`public` therefore failed readiness when the connection used `"$user", public`,
even though both resolved to the same application schema. This affected commands
such as Worker account creation, document submission and password changes.

The preflight now compares those function profiles with their owning application
schema. Controlled cutover functions retain their exact owned-schema path. Function
body hashes, registry projections, trigger properties, source ownership and UTC
checks remain required. No migration, role change or automatic connection-string
rewrite is introduced.

A read-only diagnostic against the configured Neon direct and pooled endpoints
reproduced the old predicate returning false for `"$user", public`; the repaired
predicate returned true for both tested paths on both endpoints. This verifies
readiness against the installed profile, not permission to bypass journal checks.

Neon uses transaction pooling; persistent session state is not a reliable way to
select a schema. `ALTER ROLE` affects newly established server connections and does
not immediately refresh already-open pooled connections. Keep migrations on the
reviewed direct connection and use the established explicit-schema migration
profile. See [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

The isolated PostgreSQL regression test changes caller paths, checks a partial
source set, and verifies that changing a stored function's pinned path still
fails readiness. Run it only against the dedicated local `smartsite_test`
database on port 5433. Runtime Neon credentials must never be used by this test.

## Mobile

- Password changes use the shared keyboard-avoiding request sheet, with scrollable
  inputs and a separate submit footer for both Worker and Contractor.
- Today's card waits for the scoped Worker ID and accepts only that Worker's
  active assignment at the selected Site on the current date. Empty, loading and
  failed reads remain distinct. Empty days open the calendar; template shift
  hours and the static schedule-ready notice are not shown for an empty day.
  Displayed shift and break times use the assigned shift's timezone.
- Creation keeps the account after an interrupted document bundle. The operator
  can replace an identity attachment and resubmit without creating another
  account. Unchanged retries reuse the request ID; changed attachments generate
  a new request ID. Errors use the existing localized mobile messages.

Team archival follows the existing Backend rule: move/remove active members first
and provide a reason of at least five characters. The confirmation now states the
remaining member count and links directly to member management. An empty team's
short reason produces a specific message instead of silently disabling submission.
Conflicts require an explicit reload of the team and a fresh confirmation/version;
network errors retain the dialog for deliberate retry. A successful API response
returns to the list, refreshes it through the existing query invalidation, and shows
an archived-team notice. These changes do not introduce hard deletion or archive
live teams as part of testing.

## Contractor Web

Account and identity fields are grouped separately. Citizen ID sides and the
three certificate kinds use individual upload tiles, date controls and compact
required/optional labels. Both initial onboarding and later bundle submissions
use the same file picker. Card columns adapt to their container width.

Replacing a citizen ID after a failed onboarding bundle remains possible and
changes the request ID while retaining the already-created account. File/date
checks and Safety review requirements remain in the existing API workflow.

The onboarding submit row spans both form columns, with a single-line desktop
button and a full-width button on narrow screens. Completion indicators wrap
independently instead of shrinking the submit action into half the form.

Submitting an incomplete onboarding form now reveals field-specific inline errors
and a linked error summary. The first invalid control receives focus; summary
links scroll/focus that control. Messages update as values are corrected and when
the language changes. Local checks cover identity/account fields, both citizen-ID
images, required certificates and valid declared dates. An explicitly optional
safety card needs no attachment or date unless supplied. Invalid drafts never call
account creation; server validation and the existing account/bundle retry flow
remain authoritative. The submit button is disabled only while sending or when
no Contractor scope is available, so missing fields no longer silently lock it.
The validation follow-up passed 23 tests across onboarding and document-panel
suites, including missing fields in both languages, malformed values, corrected
email submission, optional cards and interrupted-bundle retries. Browser checks
used incomplete synthetic drafts only; no account or document command was sent.

## Safety Web

The page has a full-width search/filter toolbar and an always-visible compact
batch analysis bar. A single workspace contains the Worker list on the left and the
selected profile on the right. Personal information expands on demand. Four
document cards expose citizen ID and certificate statuses, including identity
mismatch warnings. Safety opens one document section at a time; a pending or
rejected certificate opens first. Completed sections stay collapsed until chosen.
Worker and Contractor document accordions retain their existing selection behavior.

Original previews, revision history, OCR/AI controls, explicit date confirmation
and approval/rejection remain connected to the selected document's existing scoped
API commands. Changing the displayed section does not submit a review. Synthetic
tests cover switching certificates and approving the selected document. Real Web
layout checks only read existing records; no live document review was submitted.

Pending document evidence and the decision form sit side by side when the detail
container is wide enough, and stack on smaller screens. Empty official dates are
omitted for pending Safety documents; confirmation still uses the explicit review
fields. The original-file dialog is wider and displays the wrapping filename.
Long names, filenames, addresses, review notes and identity warnings wrap without
ellipsis. The primary profile status stays beside the Worker code as one unit;
the name has its own flexible row. The same code/status arrangement is used in the
queue. The citizen-ID navigation label is compact (CCCD in Vietnamese), with its
full front/back description retained in the accessible label and tooltip. Document
cards reserve consistent rows for their titles, statuses and mismatch warnings.

The status/label/AI-toolbar follow-up passed all 27 tests in the three document
and quick-scan suites. Browser fixture checks confirmed code/status alignment at
480, 720, 1024, 1280 and 1512 px, no clipped detail text, and the compact citizen-ID
label after switching English to Vietnamese. The batch AI button stays visible;
it still requires selected profiles containing eligible pending documents.

## Verification limits

Focused validation passed: Mobile 197 tests across 38 files; Web onboarding and
document-panel suites 23 tests; focused Backend tests 15 tests. Backend source/test compilation, Mobile
and Web type checks, scoped ESLint, Prettier and whitespace checks passed. The
offline pinned Expo dependency check reported dependencies up to date with its
offline-validation warning. No dependency or lockfile updates were needed.

UI and request-flow tests use synthetic records and mocked external delivery.
Web layout was inspected on the running application at desktop and narrow
widths. These checks do not establish physical-device keyboard behavior or a
complete real-device account-creation acceptance run. No native app build,
production migration or deployment is part of this change.

The dedicated PostgreSQL regression could not execute locally: the test database
at `127.0.0.1:5433` refused the connection and the Docker daemon was unavailable.
The read-only Neon comparison above does not replace that isolated regression.

Exact-head GitHub checks cover the full repository build/export, dedicated
PostgreSQL migrations/integration and container readiness. Their current results
and review status are recorded on each PR; these do not establish physical-device,
camera/face-model or production acceptance.
