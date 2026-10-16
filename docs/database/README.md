# Owner ERD baseline

`ERD-Logical.dbml` preserves the owner's supplied ERD semantics. The original
Downloads file is untouched. This repository copy normalizes CRLF to LF under
`.gitattributes` and removes trailing spaces from two empty `//` comment lines
so the repository whitespace check passes; no schema statement changes.

Original file SHA256:
`0971e449f309bd6fad35b0dbf7a66876ef0e2677f2a9fbcbff15a332b734f370`.
Repository file SHA256:
`4ccc85f7eb348492eaa8b5d402d03e83ad109c4b8f55929fb0e269f66eeb125f`.

Implementation follows this baseline. It is not regenerated from whatever code
currently does. Required new tables can extend it with documented business names
and purpose; do not rename existing business tables to match local implementations.

The file declares70 tables/735 columns. An observed canonical58 test-schema export
contains89 tables/887 columns. Preserving the original identifiers alone does not
prove type, nullability, constraints, relations or business semantics conform.

The observed extension includes17 physical `mf06_` tables and two Safety consent
tables. The four current assessment classes now use `ZoneEntry...Entity` business
names; see [extension inventory](schema-extensions.md). Existing SQL identifiers
are explicitly mapped for compatibility. They have not been silently renamed in
an applied migration. Physical naming normalization and full semantic comparison
remain open; class renaming alone is not complete ERD conformance.

Generated observed-schema DBML is a diagnostic artifact. It must not replace this
owner baseline or be presented as an accepted ERD. No production schema was changed.
The last published database CI failed at checkpoint `675d29e`; the current repair
requires a new full CI run. Entity naming review alone does not resolve failures.
