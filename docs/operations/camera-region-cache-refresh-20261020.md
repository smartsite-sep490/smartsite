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
