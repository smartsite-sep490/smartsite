# MF03 time request form — 2026-10-10

Problem: active assignments from past workdays appeared in the Worker request selector, and combined browser date/time inputs did not make overtime hours obvious.

The form now loads scoped shift templates through the existing shared client, joins them to the assigned schedules and excludes past workdays according to each shift's timezone. History and previously submitted requests remain visible. Missing or invalid shift data cannot become selectable; loading/error/retry/empty states remain explicit.

Options show work date, shift name, regular clock times and timezone. Separate Start date, Start time, End date and End time controls allow explicit overtime hours and overnight endings. Overtime defaults to the scheduled end (or a future minute if that end has passed), with an editable one-hour suggestion. Leave defaults to regular shift hours. A suggestion does not imply approval or credited time.

Input is interpreted in the selected shift's timezone and converted to UTC RFC 3339. Client validation mirrors existing Backend rules for positive intervals, future overtime, regular-hour overlap, assigned-day overtime and leave bounds. Backend remains authoritative and unchanged, including scope and idempotency behavior. Local times that do not exist during a DST transition are rejected rather than silently shifted.

Regression coverage includes past/current/future/inactive assignments, scoped template loading failure/retry, paginated schedules beyond 100 records, actual overtime submission, invalid regular-hour overlap, retained Worker forms, shift-local UTC conversion, overnight dates and nonexistent/invalid local times. Existing Site Access tests were aligned to the current plain tab names without changing navigation or authorization expectations.

Focused suite: 25/25 passed. Final `pnpm check` passed, including 375/375 Web tests, Backend 273/273 and API client 45/45 (unchanged tasks may use Turbo cache). Frozen offline installation, peers, Mobile dependency check, changed-file Prettier and diff checks passed. Docker readiness is recorded in the task response. No dependency, Backend contract, schema or migration change was required. Human review and browser/device acceptance remain separate.

Standard Compose Web build and Web-only update completed; container reached healthy. The served `index-D9GN3iTZ.js` contains the separate time controls, and local Web returned HTTP 200.
