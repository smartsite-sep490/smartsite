# Worker account command boundary

The existing account-first enrollment and account-link endpoints remain global
Admin operations. Both pass the original bearer context to the same transaction
that writes the Worker. The command rechecks the session, active actor and Admin
assignment before target access, including existing-record and repeated-link paths.

WORKER_ACCOUNT_PREPARE keeps the target-account write lock and READ COMMITTED
statement snapshots so concurrent requests find the same persisted Worker after
waiting. The target must still be active and assigned to the requested Site, or
hold the existing global Admin role. The eligible target role is held with a
share lock. An inactive linked Worker remains refused.

WORKER_ACCOUNT_LINK locks the exact Site/Worker, holds the active target account
and eligible assignment, and refuses replacement of a different existing account.
The existing unique binding constraint and error mapping remain in force.

The authority command binds actor/request hash to the Worker revision when the
compatible journal exists, refuses partial journal installation and preserves
legacy contextless callers without fabricating an actor. Repeated operations
still authenticate but do not fabricate authority revisions. Source/runtime pins
include the HTTP controller and shared writer. Test-only STAGING journal proof
is not a website migration, authority READY state or live identity acceptance.
