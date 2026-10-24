# MF06 preview timestamps — 22 October 2026

The restricted-Zone detection card and camera overlay used the viewing clock for both LIVE and REPLAY frames. The event table used capture time. A replayed observation could therefore display today's clock alongside an older capture timestamp. The review object's unused time field also inherited the viewing clock or a synthetic `00:00` fallback.

All these preview references now use the current authorized frame's `capturedAt`, formatted with the existing local-time helper. No frame produces a dash; no detection produces a dash in the Detected field. The component no longer starts a one-second viewing-clock timer. Stored assessment timestamps, API payloads, authorization, five-second frame expiry, paused guards and model behavior are unchanged.

Two parameterized LIVE/REPLAY regression cases failed before the fix, receiving the current `14:41:40`/`14:41:41` instead of the fixture capture time `07:00:00`. After repair, all28 affected cases in four files passed: desktop layout, session boundaries, read-only behavior and assessments. Scoped TypeScript and two-file lint exited0. Existing jsdom canvas/navigation warnings remain. Two earlier runner startup failures were missing explicit sandbox test-group environment variables; logs are retained, not counted as product regressions.

Evidence is under tooling `demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/`: `mf06-preview-capture-time-red-v{1,2,3}.log`, `mf06-preview-capture-time-green-v1.log`, `mf06-preview-capture-time-affected-v1.log`, `mf06-preview-capture-time-typecheck-v1.log`, and `mf06-preview-capture-time-lint-v1.log`.

Upstream was fetched and remains `0d206cdec1b2d6b926727f2b5f81367dacba42e6`; it is not fully integrated by ancestry. This isolated correction preserves the existing feature branch and does not merge, push, restart the website or apply a model. The serving Web remains v34; this fix is source-only until a separately verified rollout. Browser rendering and whole-product acceptance remain open.
