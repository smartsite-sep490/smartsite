# Safety workflow UX

Scope: Web Safety and related Representative checklist/corrective-action forms.
No API, database, permission, Mobile or AI changes.

## Behavior

- Cancelling a file picker does not close its parent dialog. A child that consumes
  Escape keeps control of that key. Explicit Cancel still discards the form
  immediately; no drafts or exit confirmation were added.
- Valid result photos survive invalid or empty replacement files and failed
  requests. The submitted photo is the retained File, not the cleared native input.
- Checklist reload fetches data without closing the editor or repeating a POST.
  It preserves answers, notes and evidence, then updates the expected version.
  Failed detail refreshes block stale submissions and show the error in the form.
  State/assignee changes block obsolete actions. A review remains tied to the
  pending submission that was opened; a replacement submission must be opened anew.
- Public business-conflict messages remain visible with neutral reload guidance.
- Checklist assignment groups date/shift/time under Work window. One planned
  window is prefilled; multiple windows require a choice; no planned window
  requires manual times. The contractor filter and criterion editor can collapse.
  Exactly one available Zone or Representative is prefilled; multiple choices
  require selection. Overview team/date context is retained.
- Changing a template does not replace criteria until Apply template is clicked.
  Edited criteria require an explicit Replace criteria action.
- Checklist reporting shows answer progress. Fail/Not applicable require a note;
  Pass offers an optional note. Required Pass evidence stays visible; optional
  attachments can collapse. Existing file limits and backend checks remain.
- Pending Worker documents open by default. Completed documents start collapsed;
  explicit user choices survive refresh. Tests and browsers use the same logic.
- Alert review controls require Safety Officer at the selected Site. Global Admin
  or Safety at another Site remains read-only for those actions.
- New labels and messages are available in English and Vietnamese.

## Open business issues (unchanged)

- Safety review of Worker Site/Zone assignments is optional before the Manager's
  decision in the current implementation.
- Scheduling and attendance expose different leave-approval paths over absence
  records. This branch does not reconcile those authorities.
- Zone-grant scope and the requirement to cover the whole checklist work window
  remain backend rules. This branch does not widen grants or bypass validation.

## Verification and limits

- Focused Vitest suites cover dialogs, checklist creation/report/recovery,
  workflow commands, navigation, English/Vietnamese rendering, Site-scoped alert
  controls and Worker document parents/panels.
  Final result: **85 tests passed across 11 files**.
- Changed TypeScript files pass ESLint with zero warnings.
- Chrome smoke checks use intercepted synthetic API data: assignment autofill,
  template protection, file cancel, conflict reload, preserved note/photo, no
  automatic POST, and explicit discard/reopen.
- A fresh independent source review found the replacement-submission and empty
  photo cases; both have regression coverage and were corrected.
- Web typecheck was attempted. Installed contract outputs are incomplete/stale;
  a temporary external configuration maps contract imports to source. It reports
  five existing errors in unchanged `contracts/src/validation/polygon-validator.ts`
  at lines 59 and 85. Typecheck is **not passing**. No errors were reported in the
  modified Web files under that configuration.
- Vitest also uses a temporary external alias for the missing built date helper.
  No dependencies, lockfiles or tracked application configuration were changed.
- No build, full repository suite, production data, camera/AI calls or Mobile
  checks were run. OS-native file-picker cancellation was not automated; Chrome
  smoke dispatches the cancel event on the real file input. Other browsers remain
  unverified.
