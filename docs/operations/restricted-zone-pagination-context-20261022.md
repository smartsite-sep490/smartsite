# Restricted Zone metadata pagination context

Existing Load more controls already covered Sites/cameras beyond100 rows; the initial missing-controls hypothesis was rejected after source inspection. Actual Agy changes correct counters to use authorized Site/scoped camera rows and preserve settled actions/drafts on transient next-page failures. Base and401/403/404 errors still hide revoked data through the existing metadata hook.

Root found and repaired a new pending-state regression: that hook returns an empty data facade even before the first page resolves, so checking data alone can falsely show a missing deep-linked selection. Keep isPending guards while allowing retained next-page-error data.

Verification: Agy saved code and tests without running commands. Root inspected the hook/callers;17initial cases passed, new pending regression RED, final18pagination cases passed in one run; final focused TypeScript and changed2fileESLint exit0. Production build/served rollout and browser UAT are not established by this commit. No runtime/evidence/permission/API/model semantics changed.
