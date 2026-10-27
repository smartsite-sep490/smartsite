# Evidence content digest wire schema v1.2

This schema extends the v1.1 five-PPE wire format with a required lowercase
64-hex SHA256 on every FRAME, CROP and SNAPSHOT evidence item. An event may still
have an empty evidence array. The digest is part of canonical event hashing.
The supplied synthetic golden vector fixes the expected canonical hash.

Schema validation checks the digest format, not the image bytes. A trusted
consumer must separately compare SHA256 of fetched evidence to the recorded
digest, enforce authorization and storage-key scope, and reject a mismatch.
Successful format validation does not establish identity, wearing, a violation
or permission. Semantic geometry validation is still required.

This PR publishes assets/tests only. Existing runtime validateObservationEvent
continues admitting v1.0 only; no Backend reader, storage, notification, worker
or model is activated. Consumer admission and hash verification are dependent
integration work. PPE UNKNOWN remains withholding a supported conclusion;
identity candidate UNKNOWN/UNAVAILABLE states are distinct.

Schema and golden-vector bytes are extracted unchanged from frozen Platform
PR61 head0d432c806b5f0e21d6d2563d6e5ec4df3025cd50. AI vendoring must use the
immutable canonical Main commit after this contract change is merged.
