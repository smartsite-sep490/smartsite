# Five-kind PPE notification compatibility

The owner approved notification compatibility for Hardhat, Safety Vest, Gloves,
Boots and Goggles on 21 October. This is source preparation on the feature branch;
it does not activate notifications on the retained website or authorize Main/MF08
integration, push, merge or deployment.

## Trigger and change

Main `0d206cdec1b2d6b926727f2b5f81367dacba42e6` rejects the three expanded MF05
subtypes in both `recordPpeAlert` and `chk_notification_ppe_target`. A caller using
the notification writer in its alert transaction would roll back that transaction.

The provider, entity and public contract now accept exactly five explicit missing
subtypes. Unknown or invented Mask/Harness/Hook missing states remain rejected.
Recipients remain current active Site Safety Officers; no Admin/Manager fallback
or new permission is introduced. The writer retains the caller's transaction and
recipient/event idempotency constraint. Listing/read rechecks current scope.

The prerequisite Main migration `PpeAlertNotifications1792886400000` is imported
byte-for-byte. New `ExpandedPpeNotificationKinds1793145600000` changes only its
PPE CHECK, requires a transaction, and refuses rollback with expanded history.
No applied migration is rewritten and rollback never deletes history. Both are
registered after the existing 70 migrations; synchronization/startup migrations
remain disabled. The unrelated authority cutover migration stays unregistered.
The local optional `ContractorResponse.siteId` contract is preserved.

Agy implemented the existing notification utilities and locales; Root reviewed
the saved code and added the shared-client type exports. PPE items now use
localized camera/Zone/subtype copy and route to `/incidents` under either
`assignedWork` mode. Missing/malformed metadata gets neutral review text. The
renderer accepts only the five contract subtypes, rather than treating an
arbitrary translation key such as `body` as a valid PPE subtype.

## Verification

Evidence directory under the existing integration assessment:
`upstream-main-0d206cd-assessment-20261021-v1/expanded-ppe-compatibility-candidate-v1`.

- Original pinned Main method: 6 PASS/3 FAIL; original PostgreSQL CHECK: 9 PASS/3 FAIL.
- Minimal candidate: 9 method cases and 14 real-PG CHECK/rollback cases pass.
- Actual source: contracts/affected Backend compile and nine-file lint pass;
  six notification unit/controller cases pass.
- Actual canonical 72-migration PostgreSQL journey passes: fresh setup, rollback
  to 71, old-history preservation, upgrade to 72, all five kinds, recipient scope,
  deduplication, transaction rollback, independent read state, revoked access,
  refused destructive rollback and existing scheduling notification compatibility.
- Only owned schemas at dedicated `smartsite_test:5433` were used. Independent
  cleanup checks confirm their absence and prior namespace names unchanged;
  this is not an audit of every other table byte.
- Web: original-source overlay produces 7 FAIL/17 PASS; actual utilities/bell/
  navigation produce 51 PASS across three files. A weak subtype-check negative
  control fails; the actual guard passes. Affected Web/client typecheck/lint pass.
  Both locales retain all 3,911 old values and add the same nine unique keys.

Preserved harness failures: malformed test include array, missing dependency
resolution for the new contract build, and missing copied schema assets. These
were corrected in test tooling; they do not represent successful source tests.

## Remaining integration boundary

Local `DurableGroupingService` and all MF08 pages remain untouched. The Main
caller/deep-link conflicts still need coordinated integration before claiming
event ingestion → persisted alert → inbox → permitted detail/browser completion.
Synthetic fixtures and provider-level tests do not prove live AI quality or UAT.

The existing scheduling notification service is now 812 lines, above the review trigger.
Root accepts this bounded exception to retain Main's provider/scope design;
ownership is Root for this compatibility slice. Reconsider extraction when another
independent notification responsibility is added, without rewriting unrelated owners' flows.
