# Historical 24-migration test profile

This catalog preserves Product commit `587faebbd1e7f9481d485d97ede92d507c51ccce`
for tests of the old seven-source authority journal. It is not a second supported
production schema. Do not import these entities or fixtures from `src/`.

`createIsolatedTestDatabase({ legacy: true })` explicitly selects these entities
and the existing frozen migration list. The default/canonical factory continues
to use current Main entities, migrations and a normal TypeORM DataSource.
Neither profile enables `synchronize` or automatic startup migrations.

Some unchanged historical callers still hold current Main entity constructor
tokens. The test-only DataSource maps only those exact known tokens to the
historical catalog. Arbitrary classes with matching names are not aliases.
This adapter must not be used by application providers or runtime bootstraps.

`provenance.json` records the immutable source commit, original Git blobs and
SHA256 hashes, plus the final snapshot hash. Snapshot headers and necessary
relative imports are documented transformations; domain logic is frozen.
The metadata boundary test checks both catalogs and the snapshot hashes without
opening a database connection.

Passing these tests proves bounded historical behavior only. Current Main API,
schema, participation/team contracts and release acceptance require their own
canonical tests. Never restore removed legacy columns to Main to satisfy an old
fixture or present historical results as current Main coverage.
