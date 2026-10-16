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

The existing large management client and PPE view are grandfathered. This bounded
adapter/lifecycle patch stays in their existing responsibilities; Root reviewed
the small PPE/Zone setup/Region client-wiring growth exceptions. The change passes
an existing client through existing props; a broader extraction needs its own
scoped follow-up, without unrelated file splitting or formatting churn.
