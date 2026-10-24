# Retained local73 runtime recovery — 22 October 2026

Actual checks at13:18VN found former Node12916/native PostgreSQL22012 absent and ports5181/5433 absent. No shutdown receipt was present; the interruption cause and graceful exit are unproven. Main/demo5434 remained under PID28320 and was untouched.

Root validated the recorded PostgreSQL executable hash, owned D: cluster, PostgreSQL18 and loopback5433 configuration, then started that existing cluster. Native startup handled its stale previous PID file; warning/logs remain preserved. No database initialization, restore, schema creation or migration occurred. The PowerShell startup observer remains waiting on its server descendant: actual readiness is proved by listener ownership and real database queries, not an observed observer exit code.

## Current runtime

- URL: http://127.0.0.1:5181/login; `/ppe`, `/zones`, `/camera-setup` also serve.
- Node43272 birth `2026-10-22T13:24:09.7942220+07:00`; PostgreSQL440 birth `2026-10-22T13:20:23.0958540+07:00`.
- Output: `D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/website-flow36-20261022-132409-2f11bb97`.
- Expiry `2026-10-22T10:23:23.075Z`, 17:23VN. Revalidate actual owner and latest mutable state before another lifecycle.
- Same Webv34 `cb187d7622ec071fa36eb4fb9804b6e5fcaab8f7`, Backend `5e118c50f51c62d735e36ae58938c6850ab00427`, schema `isolated_test_7e9ea9d26e8f917ff859f3355bddd027`, existing73 migrations. Source-only camera action accessibility fix is not rolled out.
- Node heap limit512MB. Product capture/inference workers, enqueue and Apply remain disabled. Separate bounded CPU diagnostics are not website workers; no rejected model was applied.

After PostgreSQL recovered, a fresh actual configuration capture matched every captured table/selection in the latest valid mutable snapshot. The fresh state and media hashes were saved before website launch. Existing accounts/roles/data were reused; authority history remains READY and ungapped. Media inventory was empty, so nonempty-media recovery is not proved.

The new launcher revalidates state/artifacts, periodically captures mutable configuration and retains the schema on STOP. JWT secrets renew; old browser sessions can require signing in again. Credentials remain only in the local output's DEMO.md/private receipt.

## Executed proof

HTTP checks passed: four route shells200, exact served entry-asset hash, unauthenticated Sites401, retained account login200, scoped metadata/history200, four cameras/six Zones, READY ungapped, rollback72 retained, own-session logout204 and revoked-token401.

Evidence under `product-rollout-461c857-20261021-v1`: `flow36-recovery-preflight-proof-root-v1.json`, `flow36-qualification-root-v1.json`, `flow36-http-proof-root-v1.json`, `flow36-owner-proof-root-v2.json`, `software-website-current-root-v1.json`. Owner-proof v1's PowerShell count array is preserved; v2 corrects it to ten verified pins. PostgreSQL owner/logs: `native-test-pg-recovery-20261022-132022-acfec54f`.

This is local imported-AppModule/test-environment/Vite preview proof, not production main.ts, browser rendering, playback, accuracy, deployment or capacity acceptance. The preview warning remains. Browser use is still disabled in Work settings; no alternate surface or URL-policy workaround was attempted.
