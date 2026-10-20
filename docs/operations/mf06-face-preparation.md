# MF06 claimed Face preparation

`Mf06FacePreparation.prepare` composes the existing claim-context reader,
original event-bound disk JPEG crop, consent-scoped candidate reader and Safety
Face resolver port. Site comes from the stored claim context. The resolver gets
copies of the crop bytes, invocation and candidate metadata; its response must
match every invocation field and an originally supplied reference/revision.

Context, candidate metadata and unknown response use the existing bounded
descriptor-safe JSON copier. Aborts are checked before work and after awaits.
Unavailable context/media/candidates suppress later stages. Failure results
contain only static state/reason fields, never templates, bytes or error text.
The existing 32-candidate corpus limit is enforced without truncation.

The result is `PREPARED_UNATTESTED`, not Worker identity or Zone authority.
This source does not register a provider, mount a router, schedule a worker,
append an assessment, start a model or read from a camera. Final lease/CAS,
current consent/profile, calibrated identity and covered authority checks remain
necessary before an assessment can establish an entry decision.

## Bounded verification

- Agy authored three focused cases using small synthetic JPEGs actually read
  and cropped from task-owned D-drive temporary directories, with fake existing
  context/candidate/resolver ports. Root added resolver-mutation regressions.
- Initial compilation failed because the implementation was absent; after
  implementation, final three cases passed in 1.34 s. Scoped compile/lint passed.
  A Windows ESM invocation error and an intermediate test type error are retained.
- Tests cover stage suppression, corrupt disk media, unavailable/empty corpus,
  correlation/reference/revision mismatch, accessor rejection, defensive copies
  and pre/mid-await cancellation. They do not exercise a real Face model or DB.
- Test-file LOC exception: the actual formatted fixture exceeds the 400-line
  target but stays below the 700-line exception limit. The fixture records the
  full v1.3 event, request, claim, real disk media and three composed cases;
  extracting another helper only for this test would add indirection.

P7 reviewed the new source independently; Root retained the typed AbortSignal
contract rather than adding an unused null-signal option. No Main provenance,
browser acceptance, consent legitimacy or model accuracy is inferred here.
