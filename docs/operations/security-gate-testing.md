# Security gate workspace

Assign `SECURITY_OFFICER` to the specific Site using Admin account management. A Security-only
Web account opens `/access` after login and sees two tabs: worker entry/exit and visitor entry/exit.
Other protected application routes redirect to that workspace. Accounts with additional assigned
roles keep those roles' workspaces. Backend role and Site authorization remain authoritative.

Security can read its assigned Site's workers, visits and gate history; verify worker identity by
face, an authorized QR fallback, or an explicit manual identity check; confirm actual passage;
and verify visitor QR/booking codes, select the people present and record their arrival/departure.
It can reconcile legacy visitor checkout when the required representative confirmation is given.
It cannot approve, reject or cancel visits, retry decision emails, provision users, or change gate
clearance rules. Those decisions stay with the scoped Site Manager or Admin as applicable.

## Test locally

Use the local Web at `http://localhost:5173` and API at `http://localhost:3000`. Provision a dedicated
test account through the existing account service. Complete its normal temporary-password change
before testing; do not disable password or authorization checks. Keep credentials outside Git.

- Worker tab: select the gate and IN/OUT direction. For manual verification, select the worker,
  confirm their identity and supply a reason, then confirm actual passage only after the worker
  crosses. Entry still needs the configured assignment, schedule and gate permission. Face
  recognition also requires the configured AI capability, enrollment and available camera.
- QR fallback: create an allowed camera-failure session at the gate; the assigned Worker obtains
  their own QR using their own account. Security scans that QR. Security cannot issue a Worker QR
  as though it were the Worker.
- Visitor tab: obtain a QR/booking code from a visit already approved by the assigned Site Manager.
  Load the visitor list, select people actually present, verify their identities and confirm IN/OUT.
  Check the resulting history. Rejected or cancelled visits must fail entry.
- Negative checks: direct requests for another Site's workers/visits/history and for user
  administration, visitor decisions or gate-permission changes must return `403`.

The browser smoke check exercises login, both tabs, session restoration and protected-route
redirects. Passage and authorization tests use a dedicated `smartsite_test` PostgreSQL database
with synthetic fixtures; they do not fabricate gate events in the runtime database.
