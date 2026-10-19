# MF05 desktop setup and focused wall evidence — 19 October 2026

## Product behavior

- Camera Setup separates the Site context, camera inventory, setup actions and optional guide.
- Camera rows show name, code and saved configuration status, with observation-region and management actions kept together.
- Configuration-enabled badges stay neutral: registration does not prove a live camera connection.
- Counts retain the difference between scoped visible rows and the server-returned catalog total.
- Existing Site Manager permissions, pagination, drafts, selected IDs, dialog behavior and Main login are retained.
- Monitoring header, evidence card and observation banner use the selected valid wall snapshot in four-source mode. Single-focus viewport guards remain separate.
- Current-frame UNKNOWN remains distinct from an explicitly confirmed missing-PPE episode.

## Verification

Root reviewed actual Agy p7/p5 changes and executed the checks. Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-product-ux-20261019-v1`.

- Camera affected first run: 13 failures / 263 passes across 34 files. Obsolete copy assertions were updated; the first cold lazy-route assertion now allows five seconds instead of the default one second.
- Final Camera checks: 51 passes across eight files (`camera-final.log`).
- Wall regression before implementation: three failures / one pass (`wall-red-v2.log`).
- Monitoring affected run: 94 existing cases pass; the new file initially had three selector failures after a later Agy edit (`wall-affected.log`).
- Root corrected the new selectors: an unfocused wall tile may legitimately retain its own track, and the focused evidence card may display that track in multiple fields. Final four new cases pass (`wall-final-v3.log`).
- This yields 149 distinct affected cases across separate runs, not a single 149-test invocation.
- Web TypeScript, changed-file ESLint plus the final new-test lint, and production Vite build pass. Initial ESLint 768 MiB heap exhaustion is retained; the bounded retry used 1280 MiB.
- Formatting and whitespace checked. The new dedicated test is 407 physical lines, slightly above the 400-line target and below the 700-line mandatory exception threshold; tests were not removed to meet a count.
- Agy p7 independently inspected the wall binding; Root rejected report overstatements about direct TTL checks, UI wording and unexecuted mixed status/source tests.

## Research and remaining gates

REA 6.5.0 already exists in the approved D-only sandbox; no reinstall or global MCP change was needed. Agy p8 researches public references separately from source implementation. Fluent access proceeded; Axis requires a Herdr URL approval at the last observation. New REA execution, a completed comparison and the prototype are not yet accepted evidence.

No local browser policy workaround or visual acceptance was performed. This code/bundle is not rolled out to the running website. Browser layout, keyboard/screen-reader evaluation and user acceptance remain open. The existing Access-owned ExcelJS large-chunk warning remains deferred. No AI training, model adoption, DB change, push, merge or deployment is part of this change.

## Follow-up: named camera controls

Wall tiles now expose named groups, and their real focus buttons retain the visible localized action plus the camera name, pressed state and a visible-focus style. The outer group is not a nested button or an extra keyboard stop. Pointer selection and independent Retry controls remain intact.

Root watched the new semantic test fail before the change. The first affected run exposed an obsolete generic-name keyboard selector; Root also corrected the proposed button label to retain the visible action for Label-in-Name. Final four-file run:34 passes, including Space selection while Retry is blocked. Web TypeScript, four changed-file lint and production bundle v3 pass. No active capture/model/DB change was required.

Agy p5 performed a bounded read-only cross-review. Its extra note gave a wrong source line and a nonexistent TTL constant; Root independently verified the actual scope guard and literal five-second limits and rejected those inaccurate details. Repeated Camera prefixes in group labels and browser-specific focus rendering remain polish/visual-review items, not falsely claimed complete from DOM tests.
