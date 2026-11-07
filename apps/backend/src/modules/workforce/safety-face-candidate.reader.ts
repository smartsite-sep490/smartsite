import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { snapshotMf06Json } from '../safety/assessments/mf06-json-snapshot.js';
import type { SafetyFaceCandidateTemplate } from '../safety/assessments/safety-identity-resolver.port.js';
import { getSafetyFaceTables } from './safety-face-query-scope.js';

export type SafetyFaceCandidateUnavailableReason =
  'INVALID_SCOPE' | 'ABORTED' | 'READ_UNAVAILABLE' | 'CANDIDATE_LIMIT' | 'INVALID_CANDIDATE';

export type SafetyFaceCandidateLookup =
  | Readonly<{
      status: 'AVAILABLE';
      candidates: readonly SafetyFaceCandidateTemplate[];
    }>
  | Readonly<{
      status: 'UNAVAILABLE';
      reason: SafetyFaceCandidateUnavailableReason;
    }>;

const siteIdSchema = z.uuid();
const modelVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value);

const candidateRowSchema = z.strictObject({
  profileReferenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  profileRevision: z.uuid(),
  encryptedTemplate: z
    .string()
    .max(32768)
    .regex(/^[A-Za-z0-9_-]{100,32766}={0,2}$/)
    .refine((value) => value.trim() === value),
});

const unavailable = (reason: SafetyFaceCandidateUnavailableReason): SafetyFaceCandidateLookup =>
  Object.freeze({ status: 'UNAVAILABLE', reason });

/**
 * Consent-scoped MF06 candidate template reader.
 * Returns only provisional reference hash, revision, and encrypted template bounds;
 * never establishes Worker identity, consent at finalization, or Zone authority.
 */
export class SafetyFaceCandidateReader {
  constructor(private readonly db: DataSource) {}

  async readForSafety(
    siteId: string,
    modelVersion: string,
    signal: AbortSignal,
  ): Promise<SafetyFaceCandidateLookup> {
    if (!(signal instanceof AbortSignal)) {
      return unavailable('INVALID_SCOPE');
    }
    if (signal.aborted) {
      return unavailable('ABORTED');
    }
    if (
      !siteIdSchema.safeParse(siteId).success ||
      !modelVersionSchema.safeParse(modelVersion).success
    ) {
      return unavailable('INVALID_SCOPE');
    }

    const tables = getSafetyFaceTables(this.db?.driver);
    if (!tables) return unavailable('READ_UNAVAILABLE');
    const { profileTable, workerTable, consentTable, revocationTable } = tables;
    const normalizedSiteId = siteId.toLowerCase();

    try {
      return await this.db.transaction('REPEATABLE READ', async (manager) => {
        if (signal.aborted) return unavailable('ABORTED');

        await manager.query('SET TRANSACTION READ ONLY');
        if (signal.aborted) return unavailable('ABORTED');

        await manager.query("SET LOCAL statement_timeout = '1500ms'");
        if (signal.aborted) return unavailable('ABORTED');

        const rows: unknown = await manager.query(
          `
          SELECT
            p.profile_reference_hash AS "profileReferenceHash",
            p.safety_revision AS "profileRevision",
            CASE
              WHEN octet_length(p.encrypted_template) BETWEEN 100 AND 32768
                THEN p.encrypted_template
              ELSE NULL
            END AS "encryptedTemplate"
          FROM ${profileTable} p
          JOIN ${workerTable} w ON w.id = p.worker_id
          JOIN ${consentTable} c
            ON c.profile_id = p.id
           AND c.profile_revision = p.safety_revision
           AND c.id = (
             SELECT latest.id
             FROM ${consentTable} latest
             WHERE latest.profile_id = p.id
               AND latest.profile_revision = p.safety_revision
               AND latest.purpose = 'SAFETY_MF06'
             ORDER BY latest.consented_at DESC, latest.recorded_at DESC, latest.id DESC
             LIMIT 1
           )
          WHERE w.site_id = $1
            AND w.is_active = true
            AND p.model_version = $2
            AND p.status = 'ACTIVE'
            AND p.revoked_at IS NULL
            AND p.deleted_at IS NULL
            AND p.consent_method = 'SUPERVISED_WORKER_CONFIRMATION'
            AND p.consented_at <= statement_timestamp()
            AND c.purpose = 'SAFETY_MF06'
            AND c.consent_method = 'SUPERVISED_WORKER_CONFIRMATION'
            AND c.consented_at <= statement_timestamp()
            AND c.recorded_at <= statement_timestamp()
            AND NOT EXISTS (
              SELECT 1
              FROM ${revocationTable} r
              WHERE r.consent_id = c.id
            )
          ORDER BY p.id ASC
          LIMIT 33
          `,
          [normalizedSiteId, modelVersion],
        );

        if (signal.aborted) return unavailable('ABORTED');
        if (!Array.isArray(rows)) return unavailable('READ_UNAVAILABLE');
        // shortcut: refuse over 32 profiles; require a reviewed complete-corpus protocol for larger Sites.
        if (rows.length > 32) return unavailable('CANDIDATE_LIMIT');

        let snapshotted: unknown[];
        try {
          snapshotted = snapshotMf06Json(rows) as unknown[];
        } catch {
          return unavailable('INVALID_CANDIDATE');
        }

        const seenHashes = new Set<string>();
        const seenRevisions = new Set<string>();
        const candidates: SafetyFaceCandidateTemplate[] = [];

        for (const item of snapshotted) {
          const parsed = candidateRowSchema.safeParse(item);
          if (!parsed.success) {
            return unavailable('INVALID_CANDIDATE');
          }
          const { profileReferenceHash, profileRevision, encryptedTemplate } = parsed.data;
          const revisionKey = profileRevision.toLowerCase();
          if (seenHashes.has(profileReferenceHash) || seenRevisions.has(revisionKey)) {
            return unavailable('INVALID_CANDIDATE');
          }
          seenHashes.add(profileReferenceHash);
          seenRevisions.add(revisionKey);
          candidates.push(
            Object.freeze({
              profileReferenceHash,
              profileRevision,
              encryptedTemplate,
            }),
          );
        }

        return Object.freeze({
          status: 'AVAILABLE',
          candidates: Object.freeze(candidates),
        });
      });
    } catch (error) {
      if (!signal.aborted && isTransientDatabaseFailure(error)) throw error;
      return unavailable(signal.aborted ? 'ABORTED' : 'READ_UNAVAILABLE');
    }
  }
}
import { isTransientDatabaseFailure } from '../../common/database-errors.js';
