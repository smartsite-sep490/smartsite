import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { getSafetyFaceTables } from '../safety-face-query-scope.js';

const receiptFields = {
  siteId: z.uuid(),
  workerId: z.uuid(),
  actorUserId: z.uuid(),
  sourceRecordId: z.uuid(),
  sourceRecordHash: z.string().regex(/^[a-f0-9]{64}$/),
  occurredAt: z.iso.datetime({ precision: 3 }),
};
const grantSchema = z.strictObject({
  ...receiptFields,
  profileId: z.uuid(),
  profileRevision: z.uuid(),
  purpose: z.literal('SAFETY_MF06'),
  consentVersion: z.string().trim().min(1).max(64),
});
const revocationSchema = z.strictObject({ ...receiptFields, consentId: z.uuid() });
type GrantReceipt = z.infer<typeof grantSchema>;
type RevocationReceipt = z.infer<typeof revocationSchema>;
type AppendResult = { id: string; replayed: boolean };

function tables(manager: EntityManager) {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Safety Face receipt requires a transaction');
  const result = getSafetyFaceTables(manager.connection.driver);
  if (!result) throw new Error('Safety Face receipt storage unavailable');
  return result;
}
function replay(row: { id: string; matches: boolean } | undefined): AppendResult | null {
  if (!row) return null;
  if (!row.matches) throw new Error('Safety Face receipt source conflict');
  return { id: row.id, replayed: true };
}

/** Private persistence prototype, not registered in HTTP/DI.
 * A trusted intake must authenticate scope and prove personal confirmation BEFORE calling.
 * Supplying a source hash/method is not proof of consent. Never reuse enrollment consent.
 */
export async function appendSafetyFaceGrant(
  manager: EntityManager,
  receipt: GrantReceipt,
): Promise<AppendResult> {
  const t = tables(manager),
    input = grantSchema.parse(receipt);
  const args = [
    input.sourceRecordId,
    input.sourceRecordHash,
    input.profileId,
    input.profileRevision,
    input.purpose,
    input.consentVersion,
    input.occurredAt,
    input.actorUserId,
    input.siteId,
    input.workerId,
  ];
  const existing = async () =>
    replay(
      (
        await manager.query<Array<{ id: string; matches: boolean }>>(
          `SELECT c.id, (c.source_record_hash=$2 AND c.profile_id=$3 AND c.profile_revision=$4
      AND c.purpose=$5 AND c.consent_version=$6 AND c.consented_at=$7::timestamptz
      AND c.recorded_by_user_id=$8 AND w.site_id=$9 AND w.id=$10) AS matches
     FROM ${t.consentTable} c JOIN ${t.profileTable} p ON p.id=c.profile_id
     JOIN ${t.workerTable} w ON w.id=p.worker_id WHERE c.source_record_id=$1`,
          args,
        )
      )[0],
    );
  const prior = await existing();
  if (prior) return prior;
  const profiles = await manager.query<Array<{ id: string }>>(
    `SELECT p.id FROM ${t.profileTable} p JOIN ${t.workerTable} w ON w.id=p.worker_id
     WHERE p.id=$1 AND p.safety_revision=$2 AND w.id=$3 AND w.site_id=$4 AND w.is_active
       AND p.status='ACTIVE' AND p.revoked_at IS NULL AND p.deleted_at IS NULL
       AND p.consent_method='SUPERVISED_WORKER_CONFIRMATION' FOR UPDATE OF p,w`,
    [input.profileId, input.profileRevision, input.workerId, input.siteId],
  );
  if (profiles.length !== 1) throw new Error('Safety Face receipt profile scope unavailable');
  const id = randomUUID();
  const inserted = await manager.query<Array<{ id: string }>>(
    `INSERT INTO ${t.consentTable}(id,source_record_id,source_record_hash,profile_id,profile_revision,purpose,
      consent_version,consented_at,recorded_by_user_id,consent_method)
     VALUES($9,$1,$2,$3,$4,$5,$6,$7::timestamptz,$8,'SUPERVISED_WORKER_CONFIRMATION')
     ON CONFLICT(source_record_id) DO NOTHING RETURNING id`,
    [...args.slice(0, 8), id],
  );
  if (inserted.length) return { id, replayed: false };
  const raced = await existing();
  if (!raced) throw new Error('Safety Face receipt append unavailable');
  return raced;
}

/** Revokes only an already-recorded scoped consent; preserves the historical grant/profile. */
export async function appendSafetyFaceRevocation(
  manager: EntityManager,
  receipt: RevocationReceipt,
): Promise<AppendResult> {
  const t = tables(manager),
    input = revocationSchema.parse(receipt);
  const consent = await manager.query<Array<{ id: string }>>(
    `SELECT c.id FROM ${t.consentTable} c JOIN ${t.profileTable} p ON p.id=c.profile_id
     JOIN ${t.workerTable} w ON w.id=p.worker_id
     WHERE c.id=$1 AND w.id=$2 AND w.site_id=$3 FOR UPDATE OF p,w`,
    [input.consentId, input.workerId, input.siteId],
  );
  if (consent.length !== 1) throw new Error('Safety Face consent scope unavailable');
  const args = [
    input.consentId,
    input.sourceRecordId,
    input.sourceRecordHash,
    input.occurredAt,
    input.actorUserId,
  ];
  const existing = async () =>
    replay(
      (
        await manager.query<Array<{ id: string; matches: boolean }>>(
          `SELECT consent_id AS id, (consent_id=$1 AND source_record_id=$2 AND source_record_hash=$3
      AND revoked_at=$4::timestamptz AND recorded_by_user_id=$5) AS matches
     FROM ${t.revocationTable} WHERE consent_id=$1 OR source_record_id=$2`,
          args,
        )
      )[0],
    );
  const prior = await existing();
  if (prior) return prior;
  const inserted = await manager.query<Array<{ id: string }>>(
    `INSERT INTO ${t.revocationTable}(consent_id,source_record_id,source_record_hash,revoked_at,recorded_by_user_id)
     VALUES($1,$2,$3,$4::timestamptz,$5) ON CONFLICT DO NOTHING RETURNING consent_id AS id`,
    args,
  );
  if (inserted.length) return { id: input.consentId, replayed: false };
  const raced = await existing();
  if (!raced) throw new Error('Safety Face revocation append unavailable');
  return raced;
}
