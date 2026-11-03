# Historical MF06 assessment and request projections

The public contract exposes separate parsers for persisted assessment outcomes and
request processing state, plus bounded paginated lists. An assessment ID is not an
alert ID, Worker identity or current access grant. A passed deadline does not
change a persisted PENDING or CLAIMED job into a terminal result.

Response parsers reject private and unknown fields, incompatible outcome/reason
pairs, untrusted identity-dependent outcomes, malformed timestamps, duplicate IDs
and invalid pagination. Optional frame delivery preserves the exact uint64 decimal
sequence and describes received parts only; COMPLETE does not mean assessment,
identity or evidence verification has completed.

This publishes the existing contract and parsers from the preserved MF06 work.
Backend routes, storage, enqueue, workers and website consumers are subsequent
integration work. Existing public exports remain compatible; no runtime behavior,
role, database, model or worker activation is changed by this library addition.
