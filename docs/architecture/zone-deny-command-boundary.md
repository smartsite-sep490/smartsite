# Zone DENY command boundary

The existing Site Manager endpoints create and revoke explicit Worker DENY grants.
They do not create ALLOW grants; Contractor/Worker assignment permissions remain
necessary for that flow. No new API, role, permission or schema is introduced.

Both HTTP writes pass the original bearer context into the write transaction.
The transaction rechecks the session, active account and Site Manager assignment
for the requested Site, including when a repeated revoke changes nothing.
Create holds the same-Site Zone and active Worker rows; revoke locks the exact
Site/Zone/grant row and preserves the first revocation timestamp.

When the compatible authority journal is installed, ZONE_DENY_CREATE and
ZONE_DENY_REVOKE bind the actor and canonical request hash to the grant revision
and commit receipt. A partial or incompatible journal fails closed. Legacy
internal calls retain their optional context and are never assigned a fabricated
actor. They cannot establish trusted history merely by writing a row.

Focused regression, transaction authentication, scope, no-op and isolated
PostgreSQL tests cover this boundary. Source and compiled runtime release pins
include both writer files. Frozen journal-candidate checks remain test-only
STAGING evidence, with no active authority epoch. This change does not install
that candidate, mark READY, alter the website database or prove writer closure,
live camera identity, deployment or whole-product acceptance.
