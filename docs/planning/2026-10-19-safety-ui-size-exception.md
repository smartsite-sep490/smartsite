# Scoped Safety UI size exception, 19 October

Root reviewed the following bounded growth from baseline7b78cd6. Physical lines
include ordinary formatting, comments and blanks; no assertions were compressed
or removed to meet a target.

| Existing path under `apps/web/src/components/ppe/` | Baseline | Current | Scope                                                                                     |
| -------------------------------------------------- | -------: | ------: | ----------------------------------------------------------------------------------------- |
| `Mf06AssessmentHistory.tsx`                        |      653 |     668 | Existing manual query refresh and busy-empty state.                                       |
| `Mf06AssessmentHistory.test.tsx`                   |      852 |     939 | Five actual refresh/access regressions in the existing harness.                           |
| `Mf06ZoneAssessmentPanel.tsx`                      |      850 |     868 | Busy-empty state and native request-reference disclosure.                                 |
| `Mf06ZoneAssessmentPanel.test.tsx`                 |      957 |    1099 | Busy-empty and same-request/token disclosure regressions.                                 |
| `PpeMonitoringView.tsx`                            |     3512 |    3534 | Reorder the existing evidence card, retain its expressions and expose important warnings. |
| `PpeMonitoringView.test.tsx`                       |     2129 |    2190 | One DOM hierarchy/visible-warning regression using the existing bilingual harness.        |

Owner/reviewer: Root. FE implementation: actual Agy p7/p8; Agy p5 read-only
cross-review. Scope includes the preceding5eb3949 refresh commit. Existing public
interfaces, state/query ownership, authorization, TTL and evidence selection are
preserved. This exception does not authorize unrelated parent growth or relax the
300/400-line targets for new source/tests.

Follow-up before adding another responsibility: extract the cohesive PPE evidence
card with its existing inputs and move new request/history cases into separate
bounded suites with a shared fixture. Avoid duplicating data-state ownership or
splitting markup merely to hide line counts. Worker context usage is unknown;
bounded prompts and exact paths were used, not measured token-cap proof.

Actual rendering, browser/assistive-technology and production acceptance remain
separate open gates. See `docs/operations/mf06-history-refresh-20261019.md` and the
local task evidence for executed checks.
