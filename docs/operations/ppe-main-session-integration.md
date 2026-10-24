# PPE and Main session integration

PPE metadata and live/recorded media use the existing Main session adapter. An
initial authenticated401 refreshes once and retries with the replacement Bearer
credential. A terminal authentication failure clears the current session. A
controlled PPE viewer whose token or scope differs from the application session
retains its independent client; it cannot borrow another session's credentials.

The Zone popup and its nested camera/Region metadata panel receive that owning client
from PPE. Standalone callers may omit it and keep the existing independent client.
The optional client does not change Site/credential query scopes, permissions,
Region geometry/version handling or reference expiry.
The same client now reaches explicit configuration-image requests and Region
create/polygon writes. Replacing it clears decoded references and unmounts the
previous mutation owner, aborting pending writes and suppressing late callbacks.
Equivalent normalized API URLs preserve the existing reference lifetime.
An authenticated write retry keeps the original polygon and expected revision;
a409 remains a conflict, without automatic rebasing.

Media cancellation follows both the caller and the owning session. Responses that
arrive after cancellation are discarded. The first rejected401 body is released
before refresh. Invalid empty adapter credentials never reach fetch. The auxiliary
password-session probe also releases its unused response body.

Live200 NDJSON streams have a connection deadline, without a total healthy-stream
deadline. Non-OK JSON bodies have a separate deadline and16,000-byte limit; malformed
or oversized envelopes fall back to the HTTP status. Recorded video keeps its
existing total request/body deadline,2MB limit, MIME and camera identity checks.
Credentials stay in the Authorization header, with no-store and redirect rejection.

## Verification scope

- 22 synthetic media-session/boundary cases cover refresh, terminal401, abort during
  headers/body/refresh, late responses,503, stalled/oversized error bodies, invalid
  adapter credentials, healthy live streams and password-probe cleanup.
- Real App/AuthProvider/PPE regressions use mocked HTTP to verify refresh/newBearer
  and true expiry/cache removal. Controlled metadata observer/cancellation cases
  remain covered separately.
- Shared-client and affected PPE suites, Web source/test types, lint and bundle
  checks are software evidence. They do not prove live camera/browser playback,
  model accuracy, production deployment or whole-product acceptance.
- Eleven synthetic Region-session cases cover explicit reference refresh, session
  abort, client replacement, unchanged write payloads/revision, terminal401 and
  actual parent-to-leaf client wiring. Removing only the parent forwarding makes
  both wiring cases fail. The affected Region/consumer run passed139 cases in18
  files after correcting a normalized-URL regression and three strict hook-prop
  fixtures; the earlier failures remain preserved in the local evidence logs.

## Open follow-up

Silent same-user refresh still rotates the credential scope, which can unmount
the protected workspace and discard an open Zone draft. Preserving human-authored
drafts requires separating logical workflow identity from credential/pixel scope;
never reuse old credential scopes or retain stale authorization/pixels to hide it.
AI/capture remain paused.

## Main login role resolution and shared locale fixtures

An authenticated visitor on the login route waits for the current-user query to
finish before redirecting. This avoids a temporary dashboard URL while Worker
roles are pending. Protected routes retain their existing profile-error and
authorization checks; this does not grant a new role or change Main's login UI.

Locale compatibility tests now request Vietnamese explicitly when required and
retain Main's shared language on provider unmount. Shell locale tests exercise
the real language menu while isolating the unrelated notification child, whose
own session/security behavior has separate tests. Focused routing/locale/shell
verification passed19 cases after reproducing6 failures. The wider local run
passed96 cases with one separate localization-audit failure; whole Web CI remains
open until remaining visible prose is localized. No browser or AI acceptance is
implied by these fixture and routing results.

The localization source audit resolves common and Safety namespaces separately.
Unknown options/spreads remain unresolved instead of silently accepting a key
from the wrong catalog. Parser fixtures cover property order, quoted namespace
keys, opaque options and computed properties. Technical MF identifiers and the
literal Escape key label are excluded narrowly; visible prose/ARIA scanning and
the whole-source zero-finding assertion remain enabled. Parser-only passes do
not close the separately failing visible-copy gate.

## Desktop workspace presentation

Scope selection, configuration actions and viewing controls have separate visual
groups. The focused viewport and evidence column share a540px desktop height;
the wall column has a minimum height to avoid collapsing with short content.
Repeated floating snapshot/status text is removed; capture time stays in the
evidence fields, including an explicit missing value. Detailed explanations
remain available through disclosures. Camera chips expose their pressed state
and the diagnostics disclosure names its controlled content.

MF06 tabs, result/history metadata and detail sections have clearer spacing;
the outer dialog owns scrolling. Technical IDs remain complete, and Backend
authority, UNKNOWN, session scopes and query/mutation bindings are unchanged.
The final affected desktop suite passed261 cases in20 files. Earlier failures,
including an obsolete floating-badge selector, are preserved in local logs.
These DOM checks do not establish rendered visual, contrast or screen-reader
acceptance. Same-user refresh draft continuity remains a separate open task.

The existing large management client and PPE view are grandfathered. This bounded
adapter/lifecycle patch stays in their existing responsibilities; Root reviewed
the small PPE/Zone setup/Region client-wiring growth exceptions. The change passes
an existing client through existing props; a broader extraction needs its own
scoped follow-up, without unrelated file splitting or formatting churn.

## Main PR62 integration and CI repair, 16 October

Integrated Main `3ce0358` (MF03 attendance) in merge `4898a84`, preserving Main
login/register/styles, Worker dashboard navigation, conditional/enum localization
checks and the four Safety migration slots. The canonical graph now contains58
migrations. Release54 upgrades by4; frozen legacy24 upgrades by35 and retains its
retired ledger entry (59 total). Existing data, explicit DENY and unverified Face
provenance assertions remain enabled.

Three current attendance/scheduling integration suites now use per-file canonical
schemas instead of the frozen legacy24 fixture. Cleanup is registered before
initialization. Their actual dedicated5433 runs passed1/7/1 cases; migration
upgrade verification passed3 with1 explicit approved-Main-snapshot case skipped.
Main Worker navigation and removed duplicate PPE badges have updated regression
expectations; role exclusions, identity boundaries and safety-claim checks remain.

Final full Web verification passed1516 tests/158 files with no source changes
during the run. Backend unit verification passed812 with1 skipped (813 total).
Web/Backend types and builds, changed-test lint/format, root25 and infrastructure1
passed. Local harnesses use existing version-checked sandbox dependencies; they
are not a fresh Linux frozen install or the complete CI/container pipeline.
Canvas mock and locale chunk-size warnings remain. Remote CI must verify the
pushed commit before merge. AI, camera workers and browser proof remain paused;
these results do not establish production or whole-product acceptance.
