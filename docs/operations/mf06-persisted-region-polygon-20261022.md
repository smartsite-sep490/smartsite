# MF06 persisted Region polygon compatibility

The actual registered worker received three HTTP events and completed three jobs, but all assessments were AUTHORITY_UNAVAILABLE. A separate actual MainQualifiedAuthorityReader call returned MALFORMED_ARCHIVE for each policy.

Root cause: camera configuration persists `{points:[{x,y}]}` unchanged. The historical archive codec accepted only retained tuple-array polygons. The fix accepts both strict bounded normalized representations without converting archive values or changing hashes, capture masks, migrations or policy/identity semantics.

Affected paths: shared archive codec (both V1 and V2 readers), its seal/decode tests, and freshly pinned runtime artifacts. Callers require no DTO or storage changes. Existing tuple archives remain accepted. Invalid/extra/non-finite/out-of-range/oversized objects remain rejected.

Verification: focused canonical case RED after correcting a missing-camera fixture; final whole codec file 20 PASS; focused TypeScript and changed-file ESLint exit0. Initial Windows ESM loader error, fixture failures and null-prototype assertion mismatch are retained in tooling logs. Independent Agy review and actual registered-worker replay remain required before claiming this runtime fix qualified. No current website/backend rollout, cloud, model or browser acceptance follows.
