# Main585 and Safety integration checkpoint

## Scope

The feature branch integrates upstream Main `585cc2631caf244e40af393d1abb2ceead5f9500`
while retaining Safety configuration authority transactions, immutable MF06
history, session isolation and canonical contracts. This is a local integration
checkpoint, not a GitHub merge, deployment or production acceptance.

Main adds Worker QR short codes and four Worker Document migrations. Together
with the independently reviewed Root61 registry, the result is exactly66 ordered
registrations. This is a different graph from the earlier separate Tuấn66 carrier;
its naming extensions have not been silently adopted.

## Integration repairs

- Worker compliance contact fields are saved in the existing authorized account
  creation transaction and included in its idempotency fingerprint.
- Main's Representative-only face enrollment/profile policy remains unchanged.
  Old positive Worker self-management fixtures were corrected to explicit denial;
  Representative session state, encrypted storage and Safety provenance checks remain.
- Worker Document review uses the current aligned full account and scoped Safety
  Officer role. Current token, API/session scope, worker deep links and document
  cache eviction survive logout and credential changes without stale remounts.
- Main document routes and account navigation coexist with the existing protected
  lazy shell. Unknown errors use generic translated copy without raw server details.
- Main/native upload handling retains Root request cancellation and public-error
  behavior. Locale keys retain all Root/Main entries without duplicates.
- Release fixtures now explicitly distinguish Root61, QR62 and Main66. Historical
  release54/Main35/legacy24 upgrade expectations remain independently checked.

## Verification

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/main585-backend-qualification-v1`.

- Full Backend source/test TypeScript emission: final compilev5 exit0.
- Registry/directory units55PASS after4 meaningful RED cases.
- Other affected Backend units51PASS across eight files:50 initial green plus the
  final21-case config suite after supplying the actual package manifest to the
  compiled test artifact. This is106 distinct affected units, not the full suite.
- Shared API client:127PASS/26files; new contract calendar-date boundaries2PASS.
- PostgreSQL canonical fresh/release54/Main35/legacy24 profiles4PASS; original
  columns and fixture rows, DENY and absent authority/consent adoption retained.
- Worker documents11PASS; MF01 onboarding45PASS; account/Face metadata/provenance2PASS.
  These62 cases span four files/runs, not a single62-case command.
- Dedicated loopback5433 only. File-owned schemas were removed and namespace names
  independently checked. This does not audit every byte of unrelated schemas.
- Source Web checks are recorded separately in the Herdr/camera source checkpoint:
  types, affected DOM tests, locales and lint; none is browser rendering proof.

The first Worker Document harness registered its cleanup verifier before native
fixture disposal. Its after-hook failed despite exit0, so that run was rejected.
The exact recorded owned schema was inspected and removed after the test ended;
the corrected Node test runner verifies cleanup after fixture disposal. Failed
fixtures, startup attempts and logs remain preserved.

## Runtime and remaining gates

The existing website unexpectedly lost Node8648 and PostgreSQL31516 with no new
boot or shutdown receipt. The retained cluster recovered through PostgreSQL WAL;
its actual89-table state matched the latest saved snapshot. The frozen
Backend61/Web bundle28 was restored with all approved artifact hashes preserved.
Historical source pins were reconstructed into a private immutable source archive
without substituting current dirty bytes. Demo account, roles and configuration
remain; authenticated metadata/login/logout HTTP checks passed.

The restored website has not adopted Main66 or the separate camera UI commit.
New compiled66 runtime/bootstrap, retained61 upgrade rehearsal, release/bundle
qualification and a guarded local rollout remain. Mobile/Access owner-specific
checks, independent browser/UAT, AI quality/wearer/identity/authority/capacity and
whole MF05/MF06 acceptance are still open. No AI process or MF08 implementation
was started or changed in this checkpoint.
