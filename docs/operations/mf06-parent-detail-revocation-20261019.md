# MF06 detail lifecycle after parent metadata changes

An open recorded-assessment popup previously stayed visible after its parent
request/history list lost access or removed the selected row. Root reproduced
the stale-popup behavior separately in both components after correcting the
test fixture to refetch through QueryClient; inert background buttons cannot
be clicked while the modal is open.

The request and history panels now clear their selected detail synchronously
when the authorized backing row disappears or the parent enters a base/hard
error. A pending refresh retains the authorized detail. Transient next-page
failures retain existing authorized rows under the existing pagination policy.
Cleared detail requires a new explicit selection; query recovery cannot reopen
it automatically. No API, role, identity or MF08 implementation changes.

Actual Agy p8 implementation and p5 bounded read-only review were inspected by
Root. Verification: two genuine403 regressions failed before the production
changes; final affected suite115 cases/10files passed. Parameterized cases cover
401/403/404/503, selected-row removal and pending-refresh retention for both
panels. Web typecheck, four-file lint and a fresh production Vite build passed.
The owner-deferred Visitor Excel chunk warning remains; no full bundle-budget
or browser/production acceptance is inferred from these checks.

Evidence lives under the private D-drive run
`configuration-source-current-20261019-v1`, including
`mf06-parent-navigation-red-v2.log`, `mf06-history-navigation-red-v1.log`,
`mf06-parent-detail-affected-v1.log` and `web-mf06-parent-detail-v1.log`.
Read the current release checkpoint before assuming this new build is served.
