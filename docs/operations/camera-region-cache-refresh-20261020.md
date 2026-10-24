# Camera catalog refresh after a Region write

Saving a Region changes its camera's configuration revision. The Region drawer
previously invalidated PPE/Zone queries but left the separate Camera Setup
catalog cached. Opening camera management afterward could therefore submit an
old expected revision and receive an avoidable conflict.

The existing Region invalidation helper now also invalidates Camera Setup camera
lists and the changed camera's selected-camera lookup. Matching requires the
same API, session, opaque token nonce and Site. Other cameras' individual lookups,
Site lists, credentials and scopes remain untouched. Both successful writes and
existing 409 recovery use this helper; there is no automatic write retry or
revision rebasing. Existing callback, image and authorization guards are intact.

Agy authored two parameterized regression cases and the scoped source change;
Root corrected the role-assignment fixture, reviewed actual consumer query keys,
and executed verification. Before the fix: two failures, five existing passes.
Afterward: all seven drawer cases pass, plus 44 cases in the Camera Setup and
Region panel consumer suites. Two-file lint, current contracts compilation,
focused Web TypeScript and diff whitespace checks passed.

The first test invocation failed before discovery because sandbox test-group
environment variables were absent. Initial type checks used historical contract
declarations, then incorrectly compiled contract source under Web-only stricter
options. Final verification rebuilt current contracts with their own project
options and used those declarations. Earlier failures are retained under the
local `camera-region-cache-*` evidence files, not suppressed in product code.

This is model-free DOM/client/cache proof. It does not demonstrate an actual
browser journey, deployed API interaction, current website rollout, model quality
or whole MF05/MF06 acceptance. No runtime, database, AI, MF08, cloud, dependency,
push, merge or deployment changes are included.

## Subsequent local application

At19:42VN on20October, Root applied Web1049789 to local5181 while retaining
Backendbd91985 and the same92-table/66-migration schema. Only the Region drawer
and its regression test differ in Web source from the prior served72c9acb.
The builder retained existing dependency versions and paused/unbound AI controls;
441tracked Web files were matched to1049789 and frozen with the new bundle.

Before stopping old owner61704, Root verified its exact birth/command/listener,
current configuration pointer and a fresh actual DB export. The old owner wrote
a clean shutdown receipt, disappeared and released5181; no OS exit code was
captured or invented. A second actual export after shutdown matched the current
pointer. Startup matched all92tables and retained selections before login, with
no import, migration, account or permission changes.

New owner67372 began at2026-10-20T19:42:52.8303330+07:00. Local owner metadata is
`software-main66-owner-v13.json`; expiry stays21October13:32:28VN. Actual HTTP
checks verified exact index/entry plus20assets used by Camera Setup/PPE/Zone,
login200, unauthenticated Sites401, manager login/Sites200 and logout204.
1726release pins were checked at startup. No capture/inference/Python worker ran.

The initial preparation recorded an OS-exit0 guard it could not substantiate;
the unused v1 artifacts are preserved. Final v2 explicitly requires the clean
shutdown receipt plus exact owner/listener absence and records the OS code as
unobserved. It does not bypass authentication, scope checks or schema retention.
The known large Access/Excel bundle warning remains owner-scoped and unchanged.
These are local static/HTTP/software observations, not browser rendering,
production deployment, AI quality or full MF05/MF06 acceptance.
