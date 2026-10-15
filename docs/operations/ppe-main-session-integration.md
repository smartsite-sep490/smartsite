# PPE and Main session integration

PPE metadata and live/recorded media use the existing Main session adapter. An
initial authenticated401 refreshes once and retries with the replacement Bearer
credential. A terminal authentication failure clears the current session. A
controlled PPE viewer whose token or scope differs from the application session
retains its independent client; it cannot borrow another session's credentials.

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

## Open follow-up

Silent same-user refresh still rotates the credential scope, which can unmount
the protected workspace and discard an open Zone draft. Preserving human-authored
drafts requires separating logical workflow identity from credential/pixel scope;
never reuse old credential scopes or retain stale authorization/pixels to hide it.
Zone child-client integration is a separate follow-up. AI/capture remain paused.

The existing large management client and PPE view are grandfathered. This bounded
adapter/lifecycle patch stays in their existing responsibilities; Root reviewed
the small PPE growth exception. Follow-up extraction belongs with session-bound
PPE child-client integration, without unrelated file splitting or formatting churn.
