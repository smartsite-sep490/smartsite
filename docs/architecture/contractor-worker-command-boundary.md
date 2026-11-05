# Contractor Worker creation command boundary

Both existing Worker-profile creation routes forward the original bearer into
CONTRACTOR_WORKER_CREATE. The transaction rechecks the active actor and current
Contractor Representative role for the requested Site. Actor and command context
must name the same account. The existing Contractor grant, active Contractor and
current active Site participation are checked and held through the Worker write.

The Worker is created under the requested Contractor and Site. It has no linked
software account; creation does not establish camera identity or Zone permission.
The existing duplicate external-ID conflict remains a rollback, not an overwrite.

The command captures only the Worker authority source with actor/request hash and
commit receipt when the compatible journal exists. Partial journal installation
fails before mutation. Legacy internal calls retain optional context and their
existing actor checks without fabricated trusted attribution. All three writer
files were already required by source/runtime release pins.

Unit fixtures support the catalog and row-lock APIs while retaining their original
allow/deny assertions. Real PostgreSQL and frozen STAGING journal proof cover the
write and rollback boundary. These checks do not close assignment/Team writers,
install history in the website, activate authority, deploy or prove production.
