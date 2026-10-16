# Safety setup navigation

The owner approved task-based desktop navigation after the operational UX
research. This slice separates camera/area setup from daily PPE monitoring;
it does not certify the whole website or replace Main login and MF08.

## Behavior

- `/camera-setup` is a lazy metadata page. Main supplies its verified session
  and session-aware API client; no capture, preview, raw, replay or model runs.
- Global Admin manages camera metadata, including inactive cameras. Enabled
  configuration is not evidence of an online source or working detection.
- A Site Manager assigned to the selected Site can reach the existing Zone
  policy dialog without preview permission. Admin owns camera/Region writes;
  role/scope checks and Backend authorization remain unchanged.
- In Main, the PPE configuration block becomes one setup entry carrying scoped
  Site/camera IDs. Existing standalone PPE consumers retain their old dialogs.
- Setup reuses the existing registration, management and Zone/Region dialogs;
  it does not add a second geometry or policy writer.
- Metadata pages load20 rows explicitly. Failed base refresh hides stale rows;
  a transient next-page failure retains authorized rows and retries its offset.
  Wrong-Site cameras are excluded, and credentials never enter query keys.
- Losing actor/role/token/Site scope removes private forms. Closed-dialog
  callbacks cannot revoke a replacement dialog or credential scope.
- A short expandable guide explains the three setup responsibilities. No tour
  completion, connection status or acceptance is invented.

## Boundaries still open

Moving the complete Zone/Region authoring workflow into page details, unsaved
draft recovery across browser-history navigation, broader onboarding, history
navigation and browser/device acceptance remain separate work. Existing dialog
credential-rotation behavior is retained, not called seamless draft continuity.
No Backend, contract, database, model, Main login or MF08 implementation changes.

## LOC exception for existing integration points

Owner/reviewer: Root. Baseline5428137; normal formatting retained.

| Existing file                                       | Before | After | Reason and follow-up                                                                                                                                       |
| --------------------------------------------------- | -----: | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app.tsx`                              |    623 |   640 | Lazy setup route and scoped navigation. Extract cohesive route composition before unrelated growth.                                                        |
| `apps/web/src/components/layout/AppLayout.tsx`      |    485 |   504 | One capability-based setup menu entry and its type. Extract navigation configuration before another responsibility is added.                               |
| `apps/web/src/components/ppe/PpeMonitoringView.tsx` |   3413 |  3464 | Main setup link and initial metadata selection; standalone dialogs and evidence logic retained. Extract setup orchestration before further feature growth. |

New page, catalog view and metadata hook remain separate cohesive units below
300 lines each; the new focused test file remains below400 lines. No tests or
validation were removed to meet these targets.
