# Reviewed release 72 test alignment

The independent integration-test registry accepted only retained 61/62/66 migration graphs, so it rejected the current registered 72 graph before executing integration work. Extend its explicit ordered allowlist to the six reviewed additions; preserve historical graph support and reject missing, duplicate, reordered, unknown and malformed registrations. No production registry or migration SQL changes.

Canonical migration proof now compares against fetched Main `0d206cdec1b2d6b926727f2b5f81367dacba42e6` plus the nine explicit Safety/compatibility additions. Existing Main/baseline byte comparisons remain. AuthorizationHistoryCutover remains unregistered.

Verification: focused TypeScript and three-file ESLint exit 0; three metadata/source tests pass with zero skips. The tests do not initialize a database. Added assertions retain initialized-instance and malformed/reordered input coverage. An initial rerun used the wrong fixture connection user and was rejected by the test environment guard; corrected fixture metadata passed without connecting.

Evidence directory: `D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/product-rollout-461c857-20261021-v1/`, logs `reviewed-release-current-types-v2.log`, `reviewed-release-current-lint-v2.log`, failed `reviewed-release-current-v2.log`, passing `reviewed-release-current-v3.log`.

This repairs test verification infrastructure; it does not establish full CI, browser, model, deployment or whole-flow acceptance. A future approved 73 registration must update the explicit registry and manual forward-migration fixtures together.
