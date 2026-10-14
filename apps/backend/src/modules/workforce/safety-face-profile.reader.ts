import type { EntityManager } from 'typeorm';
import { z } from 'zod';

export interface SafetyFaceProfileReference {
  profileReferenceHash: string;
  profileRevision: string;
  modelVersion: string;
}
export type SafetyFaceProfileLookup =
  | { state: 'UNAVAILABLE' }
  | {
      state: 'ELIGIBLE_METADATA';
      workerId: string;
      siteId: string;
      profileId: string;
      profileRevision: string;
      consentId: string;
    };

/** Workforce-owned metadata projection; neither a template reader nor a Face verifier. */
export class SafetyFaceProfileMetadataReader {
  async findCurrentForSafety(
    manager: EntityManager,
    siteId: string,
    reference: SafetyFaceProfileReference,
    lockForFinalization = false,
  ): Promise<SafetyFaceProfileLookup> {
    const unavailable: SafetyFaceProfileLookup = { state: 'UNAVAILABLE' };
    if (
      !z.uuid().safeParse(siteId).success ||
      !referenceSchema.safeParse(reference).success ||
      (lockForFinalization && !manager.queryRunner?.isTransactionActive)
    )
      return unavailable;
    try {
      const rows: {
        workerId: string;
        siteId: string;
        profileId: string;
        profileRevision: string;
        consentId: string;
      }[] = await manager.query(
        `
        SELECT w.id AS "workerId", w.site_id AS "siteId", p.id AS "profileId",
          p.safety_revision AS "profileRevision", c.id AS "consentId"
        FROM face_profile p JOIN worker w ON w.id=p.worker_id
        JOIN safety_face_consent c ON c.profile_id=p.id AND c.profile_revision=p.safety_revision
          AND c.id=(SELECT latest.id FROM safety_face_consent latest
            WHERE latest.profile_id=p.id AND latest.profile_revision=p.safety_revision
              AND latest.purpose='SAFETY_MF06'
            ORDER BY latest.consented_at DESC,latest.recorded_at DESC,latest.id DESC LIMIT 1)
        WHERE w.site_id=$1 AND w.is_active=true AND p.profile_reference_hash=$2
          AND p.safety_revision=$3 AND p.model_version=$4
          AND p.status='ACTIVE' AND p.revoked_at IS NULL AND p.deleted_at IS NULL
          AND p.consent_method='SUPERVISED_WORKER_CONFIRMATION' AND p.consented_at <= statement_timestamp()
          AND c.purpose='SAFETY_MF06' AND c.consent_method='SUPERVISED_WORKER_CONFIRMATION'
          AND c.consented_at <= statement_timestamp() AND c.recorded_at <= statement_timestamp()
          AND NOT EXISTS (SELECT 1 FROM safety_face_consent_revocation r WHERE r.consent_id=c.id)
        LIMIT 1
        ${lockForFinalization ? 'FOR UPDATE OF p,w,c' : ''}
      `,
        [siteId, reference.profileReferenceHash, reference.profileRevision, reference.modelVersion],
      );
      if (!rows[0]) return unavailable;
      return { state: 'ELIGIBLE_METADATA', ...rows[0] };
    } catch (error) {
      // Candidate migration is not registered on the unreconciled branch/runtime yet.
      // Unavailable metadata is distinct from transient database failures, which remain errors.
      const code = (error as { code?: string }).code;
      if (code === '42P01' || code === '42703') return unavailable;
      throw error;
    }
  }
}

const referenceSchema = z.strictObject({
  profileReferenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  profileRevision: z.uuid(),
  modelVersion: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => value.trim() === value),
});
