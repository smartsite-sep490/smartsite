# Safety and contractor workspaces

Safety uses the existing overview at `/dashboard`. The operational screens live under the expanded Safety Operations sidebar group:

| Screen                                    | URL                         |
| ----------------------------------------- | --------------------------- |
| Alerts                                    | `/incidents?tab=alerts`     |
| Incidents                                 | `/incidents?tab=incidents`  |
| Checklists assigned by Safety             | `/incidents?tab=checklists` |
| Safety tasks assigned by the Site Manager | `/incidents?tab=tasks`      |
| Worker documents and review               | `/worker-documents`         |
| Contractor assigned work                  | `/assigned-work`            |

Legacy `tab=overview` and `tab=documents` links redirect while preserving their Site and Worker parameters. Existing frame, person and identification workspaces retain their separate navigation and behavior. An explicitly unavailable Site is reported instead of silently opening another Site.

Alert and Incident queues use independently scrolling list and detail panes on desktop. Below 1024px the list and detail are separate views with a Back control. Filters, pagination, detail headings and relevant actions stay outside the scrolling content. Incident content is grouped into Summary, Handling, Evidence and History. Alert content is grouped into Review, Evidence and History.

Native Safety dialogs host select and date/time popovers in their own browser top layer. Long command forms scroll their fields while keeping the heading and submit action visible. Drafts and selected uploads retain the existing retry/conflict behavior.

Contractors can start assigned work and report results using the existing commands. Safety can approve a pending result or request rework. Controls retain the existing Site, Contractor, assignee, current Action and version checks; menu visibility does not grant permission. Each handover is labelled separately, and the fixed action bar operates on its selected handover and submission.

Mobile notification navigation carries the optional `actionId` to the Incident screen, highlights and scrolls to that handover, and accepts old notifications without it. Missing or inaccessible targets do not fall back to another editable Action. Opening another Incident releases the previous notification target. No API or schema changes are required.

## Verification

Run the repository gates from the root:

```sh
pnpm install --frozen-lockfile
pnpm peers check
pnpm check
pnpm --filter @smartsite/mobile check:dependencies
```

The dedicated browser suite uses installed Chrome and intercepts all business API calls with synthetic in-memory fixtures:

```sh
pnpm --filter @smartsite/web exec playwright test e2e/safety-contractor-workflow.e2e.ts
```

It checks 1920×1080, 1366×768, 1024×768 and 390×844 layouts, independent scrolling, long forms, native-dialog dropdown hit testing, canonical/legacy navigation, Back/Forward, and assignment → start → report with JPEG → rework → resubmit → approval. Screenshots are generated under `apps/web/test-results/i18n/`.

Mobile unit tests cover notification targets, repeated navigation, authorization and read-only handovers. Browser tests at 390px verify responsive Web only; Android/iOS export and unit tests do not replace device/emulator testing.

On Windows with nvm, the camera worker supervisor tests reject linked executable paths by design. If `process.execPath` differs from its resolved path, run the gates with the real Node installation directory first in the command's `PATH`; do not weaken the backend path check.
