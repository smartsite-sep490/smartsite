# Partitioned observation frame admission

The Backend accepts v1.4 only when AI_PARTITIONED_FRAME_ENABLED=true; the default remains false. Existing v1.0/v1.1/v1.2 admission remains unchanged. This extraction does not activate v1.3, enroll a worker, prove track continuity or start a producer.

For a resolved camera, ingestion verifies frame siblings inside the existing transaction. Camera/session/frame and exact uint64 sequence acquire consistently ordered transaction locks. Siblings must agree on capture timestamp, dimensions, count, sequence, person/identity context and available full-frame image digest. Reused part indices and overlapping person/region partitions conflict. Stored raw hashes are checked before correlation; corrupt stored context fails unavailable.

A forward migration adds two partial indexes on the existing raw-event table, including unique camera/session/frame/part. No new table is created. Apply the migration before enabling intake. Reverting indexes retains events but requires intake disabled first; no automatic rollback or production flag change is performed.

Grouping uses the admitted frame to reuse an existing finding without incrementing detection count or creating another PPE notification for a late sibling, including when the finding has since closed. Independent frames and source sessions retain separate detection semantics. Candidate locks are acquired in stable grouping-key order, while response IDs and exact person mappings preserve observation order.

Recipient policy remains unchanged. Main currently emits PPE notifications; Zone notification bridging and MF06 job/enqueue integration remain separate extractions. The frozen integration fixture was adapted to assert this actual boundary rather than introduce unrelated delivery changes. No changes are made to Worker identity or capture-time Zone authorization.

Checks cover schema/flag rejection, sibling conflicts, raw/hash corruption, lock order, actual concurrent PostgreSQL ingestion, delayed siblings, retries, exact sequence values beyond JavaScript safe integer, scope isolation, large partitions and index reversal without row loss. Subject migration tests retain their historical profile while the frame journey exercises the complete 66-migration graph. This is software evidence, not camera quality, cross-frame tracked episodes, browser or production acceptance.
