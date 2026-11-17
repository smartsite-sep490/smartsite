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

## C02 retrospective assessment candidate

The explicit `tracked-v17-identification-ppe-authority` migration profile adds a
retrospective path. A Safety Officer assigned to the Site can request a separate
assessment of the original capture after a current, accepted C02 identification.
The original request and assessment remain in history.

- `GET /sites/:siteId/safety-identification-requests/:id/retrospective-assessment-options`
  returns the current identification revision and original Zone requests that
  match the published evidence's event, person and frame SHA. Scheduled pairs are
  excluded. The response includes capture time, Camera and Zone names.
- `POST /sites/:siteId/safety-identification-requests/:id/retrospective-assessment`
  accepts `commandId`, `episodeId`, `identificationVersion` and
  `initialRequestId`, returning 202 with `requestId`. Backend derives Worker
  identity from C02 and checks the exact scope again. Retry with the same command
  or the same acceptance/original pair returns the recorded request.
- `GET /sites/:siteId/safety-identification-requests/:id/retrospective-assessments`
  returns a bounded `items/total` page using `offset/limit`. Items distinguish
  pending processing, the retrospective result and the original outcome. Capture
  time retains microsecond precision. Synthetic authority is exposed as
  `UNAVAILABLE/AUTHORITY_UNAVAILABLE`.

Each route rechecks Site-scoped Officer access and uses `private, no-store`.
Site Managers cannot read or submit these assessments through their C02 task
assignment. Responses omit Worker identity, private authority archives and action
IDs. A successful request creates a job. A later assessment records event-time
authorization and does not itself issue a safety notification.

Manual identity evidence pins the immutable C02 acceptance and original frame.
It has no Face profile revision or Face crop. Worker finalization revalidates the
acceptance and original admission in the same transaction as the append.
