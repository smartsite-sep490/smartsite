# MF06 preparation lease budget, 19 October

The private worker previously dispatched preparation without checking the returned
lease/deadline, and its configured resolver timeout could exceed both. Final store
CAS still prevented expired writes, but external I/O could continue unnecessarily.
This was reproduced in deterministic software tests, not observed in a live worker.

The worker now bounds preparation by the earlier lease/deadline and configured
resolver timeout. Expired or invalid times return STALE before dispatch. Expiry
aborts pending preparation, blocks queued finalization and stops serialization
retries. Late resolver completion cannot finalize. Ordinary resolver timeout and
explicit cancellation retain their existing retry/cancel behavior.

Local clock checks bound resource use only; they do not establish lease ownership,
identity or access. Final authorization still requires the existing database-clock
lease CAS. A clock ahead of the database may conservatively stop work early;
this change does not certify clock synchronization. An adapter that ignores its
abort signal can continue remote work, but the worker ignores its late result.

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/mf06-lease-budget-20261019-v1`.

- Initial eight-case regression:7FAIL/1PASS before implementation.
- Final ten-case suite against exact99d0cce worker:9FAIL/1PASS.
- Current source:29PASS/3files, including ten new expiry cases and existing
  cancellation, drain, timeout and serialization behavior. Targeted compile,
  full Backend types, changed-file lint and formatting PASS.
- A missing fixture result reason and an out-of-scope dependency loader failure
  were repaired and retained separately from the genuine assertions.

No new dependency, schema, permission, runtime registration, job consumption,
resolver invocation, model or camera action occurred. The running local website
still uses the frozenbd91985 Backend; this worker is not deployed or enabled.
Repository source-pin drift must be reconciled on the next guarded release,
rather than mislabeling the old receipt as current source. Real WorkPort/media,
profile/consent, authority cutover and full MF05/MF06 acceptance remain open.
