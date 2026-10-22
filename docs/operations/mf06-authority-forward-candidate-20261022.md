# Forward identity for the unapplied authority-history cutover candidate

Root fetched origin/main22October:0d206cdec1b2d6b926727f2b5f81367dacba42e6. The private unregistered candidate1793059200000 predates the latest local registered1793145600000. Local source and freshly fetchedMain have no1793232000000 collision. Move only the still-unapplied candidate filename/class/name to AuthorizationHistoryCutover1793232000000 and update its3test/fixture imports. All applied migrations remain unchanged and typeorm.options still registers72, not this candidate.

Exact equivalence self-check against frozen Backendcb187d7 confirms no SQL/import/functionprofile/body/guard changes after timestamp substitution. No database migrationhistory is rewritten. Existing earlier rehearsal hashes/paths retain their old identities and remain historical evidence, not silently relabeled. New physical rollout/source registration still requires final coordination/ownerlocalcutoverdecision.

Checks: identity test1RED→1GREEN verifies exactnewname, timestamp greater than allregistered migrations and absent from registration. Affected fixture/integration consumers compile; changed5filelint0. No duplicate migration DB rehearsal for a name-only change; actual unchanged SQL already qualified with populatedSTAGING and unusedDown. Independent peer identity review pending. Website continuesWebv34/Backendcb187/schema72 withoutworkeractivation.

Planned physical additions remain authorization_history_epoch.activated_at and gapped_at nullabletimestamptz with exactguard constraints. Neither old history activation nor prior rights/Workeridentity is inferred. These twofields are not yet in the serving schema or user-approvedbaseline ERD; coordinate extension before local73activation.
