# Contractor participation and representative-grant commands

Existing ownership remains unchanged: a scoped Site Manager registers Contractor
participation in their Site; a global Admin grants a Contractor representative.
Both endpoints pass the original bearer into the write transaction. Current
account/role checks run before writing and before accepting an existing grant.
The server actor and command context must refer to the same account.

MAIN_PARTICIPATION_CREATE records Contractor/Site and the exact interval.
MAIN_REPRESENTATIVE_GRANT records Contractor/target user. Each operation captures
only its existing authority source. Target rows and representative-role eligibility
are held during writes. Existing interval errors, missing-target errors and grant
retry behavior remain intact; no new target active-account rule is introduced.

The source and compiled-runtime release pins now include this service/controller.
That pinning does not close the service's other mutators. Worker creation,
assignment workflow, Team and remaining callers still need their own command
boundaries and proof. Contextless internal fixtures retain their existing actor
checks but do not receive fabricated trusted journal attribution.

Focused regressions, current-role/session and scope checks, isolated PostgreSQL
and frozen STAGING journal proofs cover these two operations. They do not install
history in the website, activate an authority epoch, deploy or establish complete
MF05/MF06 or production acceptance.
