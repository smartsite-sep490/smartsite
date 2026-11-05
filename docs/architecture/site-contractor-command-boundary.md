# Site Contractor command boundary

The existing Site-scoped Contractor create and rename endpoints remain Site
Manager operations. A global Admin role does not bypass the Site assignment.
Both endpoints forward the original bearer for reauthentication, active-account
and Site Manager checks in the actual write transaction, including code reuse.

Creation uses SITE_CONTRACTOR_CREATE and records the actor, Site and code in the
command descriptor. It preserves generated codes, matching active-code reuse,
name/inactive conflicts and unique-code error mapping. It does not create a
participation or expand an existing Contractor's permissions.

Rename remains metadata: it locks the Contractor, requires participation in the
requested Site, refuses profiles shared with other Sites and checks expectedName
before updating. Changing a name does not fabricate an authority revision. It
therefore uses authenticated metadata mutation rather than a permission command.

Both writer files are already required by source/runtime release pins. Existing
internal callers retain optional context without a fabricated actor. Owned test
PostgreSQL and frozen STAGING journal proofs do not install history in the website,
create an active authority epoch, establish complete writer closure or prove
production acceptance.
