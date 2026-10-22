# Proposed authority73 source integration

Prepared against `3828cea`; NOT applied to production source or the serving schema. `authority73-coherent.patch` changes nine files together:

- Register the existing forward migration once, after all current timestamps. No migration SQL edits.
- Add an explicit test-only predecessor72 selection, validating the exact reviewed73 graph before removing its last migration. Default tests continue to use the real release graph.
- Three manually upgrading fixtures opt into predecessor72, preserving baseline-before-upgrade coverage and avoiding duplicate Up.
- Extend strict independent migration allowlist and metadata/identity proofs to73, preserving61/62/66/72, Main byte comparisons and malformed/duplicate/reordered rejection.

Root prepared this after Agy p7 reported exhausted quota; no Agy implementation or independent approval is claimed. `git apply --check` passes against the unchanged source. A complete copied source/test tree with this patch compiles; four metadata/source cases pass with zero skips and without initializing PostgreSQL. Compile caught a readonly options assignment; the candidate now uses an object spread. Both failed and passing logs remain under the rollout directory as `coherent73-types-v1.log`, `coherent73-types-v2.log`, `coherent73-metadata-v1.log`.

Pending: run the changed real-PG fixtures against this exact candidate; independent review when available; freeze committed build/runtime pins and finish the concrete local lifecycle package. Current owner approval covers serving schema72, not73 or the new nullable epoch activation/gap timestamps. No website restart, schema change, history activation or model application is authorized by this proposal. Existing prior registered73 sandbox clone/fresh-main proof does not replace these changed fixture checks.
