import type { EntityManager } from 'typeorm';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { snapshotMf06Json } from './mf06-json-snapshot.js';
import { loadMf06RequestAdmission } from './mf06-event-admission.js';
import { bindMf06FaceInvocation, type Mf06FaceBinding } from './mf06-face-binding.js';
import { inspectMf06StoredBinding } from './mf06-request-context.js';
import { selectMf06FrameReference } from './mf06-frame-reference.js';
import { readConsistentMf06RawEvent } from './mf06-observation-event.js';
import {
  inspectSafetyFaceResponse,
  isSafetyFaceInvocation,
} from './safety-identity-resolver.port.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import type {
  SafetyFaceProfileLookup,
  SafetyFaceProfileReference,
} from '../../workforce/safety-face-profile.reader.js';
import type { SafetySubjectCrop } from '../identity/safety-subject-cropper.js';

export type Mf06CandidateMetadataResult =
  | {
      state: 'UNAVAILABLE';
      reason:
        | 'SERVICE_DISABLED'
        | 'INVALID_BINDING'
        | 'INVALID_RESPONSE'
        | 'CORRELATION_MISMATCH'
        | 'IDENTITY_UNAVAILABLE'
        | 'TRANSACTION_REQUIRED'
        | 'PROFILE_UNAVAILABLE'
        | 'ABORTED';
    }
  | {
      state: 'ELIGIBLE_PROFILE_METADATA';
      provenance: 'SYNTHETIC_TEST' | 'TRUSTED_SERVICE';
      siteId: string;
      requestId: string;
      bindingDigest: string;
      contextDigest: string;
      workerId: string;
      profileId: string;
      profileRevision: string;
      consentId: string;
      identityEstablished: false;
      authorityEstablished: false;
    };

export interface Mf06CandidateProfileReader {
  findCurrentForSafety(
    manager: EntityManager,
    siteId: string,
    reference: SafetyFaceProfileReference,
    lockForFinalization: boolean,
  ): Promise<SafetyFaceProfileLookup>;
}

const id = z.uuid();
const profileSchema = z.strictObject({
  state: z.literal('ELIGIBLE_METADATA'),
  siteId: id,
  workerId: id,
  profileId: id,
  profileRevision: id,
  consentId: id,
});
const MAX_CROP_BYTES = 2 * 1024 * 1024;
type Reason = Extract<Mf06CandidateMetadataResult, { state: 'UNAVAILABLE' }>['reason'];
const unavailable = (reason: Reason): Mf06CandidateMetadataResult => ({
  state: 'UNAVAILABLE',
  reason,
});

/**
 * Private metadata finalization boundary. The original request/event and current
 * profile revision/consent are rechecked inside the caller's SERIALIZABLE CAS
 * transaction. The caller must append/finalize before that transaction ends.
 * No resolver, media read, model, producer attestation, identity or permission assertion.
 */
export class Mf06CandidateMetadataService {
  constructor(
    private readonly profiles: Mf06CandidateProfileReader,
    private readonly channel: 'DISABLED' | 'SYNTHETIC_TEST' | 'TRUSTED_SERVICE' = 'DISABLED',
  ) {}
  async revalidate(
    manager: EntityManager,
    siteId: string,
    requestId: string,
    prepared: Mf06FaceBinding,
    crop: SafetySubjectCrop,
    response: unknown,
  ): Promise<Mf06CandidateMetadataResult> {
    if (!['SYNTHETIC_TEST', 'TRUSTED_SERVICE'].includes(this.channel))
      return unavailable('SERVICE_DISABLED');
    if (!manager?.queryRunner?.isTransactionActive) return unavailable('TRANSACTION_REQUIRED');
    try {
      prepared = snapshotMf06Json(prepared) as Mf06FaceBinding;
      if (!crop || ![Object.prototype, null].includes(Object.getPrototypeOf(crop)))
        return unavailable('INVALID_BINDING');
      const descriptors = Object.getOwnPropertyDescriptors(crop);
      if (
        Object.getOwnPropertySymbols(crop).length ||
        Object.values(descriptors).some((field) => !field.enumerable || !('value' in field))
      )
        return unavailable('INVALID_BINDING');
      const bytes = descriptors.bytes?.value;
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_CROP_BYTES)
        return unavailable('INVALID_BINDING');
      const metadata = Object.fromEntries(
        Object.entries(descriptors)
          .filter(([key]) => key !== 'bytes')
          .map(([key, field]) => [key, field.value]),
      );
      crop = {
        ...(snapshotMf06Json(metadata) as Omit<SafetySubjectCrop, 'bytes'>),
        bytes: Buffer.from(bytes),
      };
    } catch {
      return unavailable('INVALID_BINDING');
    }
    if (
      !id.safeParse(siteId).success ||
      !id.safeParse(requestId).success ||
      prepared?.state !== 'BOUND_UNATTESTED' ||
      !isSafetyFaceInvocation(prepared.invocation) ||
      !Buffer.isBuffer(crop?.bytes) ||
      crop.bytes.length < 1 ||
      crop.bytes.length > MAX_CROP_BYTES
    )
      return unavailable('INVALID_BINDING');
    const site = siteId.toLowerCase(),
      requestKey = requestId.toLowerCase();
    // All caller-owned JSON and bytes were snapshotted before any await.
    const invocation = Object.freeze({ ...prepared.invocation });
    const savedCrop = crop;
    const inspectedResponse = inspectSafetyFaceResponse(invocation, response, this.channel);
    const isolation: { transaction_isolation: string }[] = await manager.query(
      'SHOW transaction_isolation',
    );
    if (isolation[0]?.transaction_isolation !== 'serializable')
      return unavailable('TRANSACTION_REQUIRED');
    const request = await manager.getRepository(ZoneEntryAssessmentRequestEntity).findOne({
      where: { requestId: requestKey, siteId: site },
      lock: { mode: 'pessimistic_read' },
    });
    if (
      !request ||
      !id.safeParse(request.requestId).success ||
      !id.safeParse(request.siteId).success ||
      !id.safeParse(request.eventId).success ||
      request.requestId.toLowerCase() !== requestKey ||
      request.siteId.toLowerCase() !== site
    )
      return unavailable('INVALID_BINDING');
    const event = await manager.getRepository(AiObservationEventEntity).findOne({
      where: { eventId: request.eventId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!event) return unavailable('INVALID_BINDING');
    if (!(await loadMf06RequestAdmission(manager, event, request)))
      return unavailable('INVALID_BINDING');
    const stored = inspectMf06StoredBinding(request, event);
    if (stored.status !== 'MATCHED') return unavailable('INVALID_BINDING');
    const raw = readConsistentMf06RawEvent(event);
    if (!raw) return unavailable('INVALID_BINDING');
    if (
      raw &&
      typeof raw === 'object' &&
      'schemaVersion' in raw &&
      ['1.2.0', '1.3.0', '1.4.0'].includes(raw.schemaVersion as string)
    ) {
      const frame = selectMf06FrameReference(raw, stored.request);
      if (!frame || frame.sha256 !== savedCrop.frameSha256) return unavailable('INVALID_BINDING');
    }
    const rebound = bindMf06FaceInvocation(
      stored,
      savedCrop,
      invocation.invocationId,
      invocation.modelVersion,
    );
    if (rebound.state !== 'BOUND_UNATTESTED' || !isDeepStrictEqual(rebound.invocation, invocation))
      return unavailable('INVALID_BINDING');
    if (inspectedResponse.state !== 'CANDIDATE_REFERENCE')
      return unavailable(inspectedResponse.reason);
    if (!manager.queryRunner?.isTransactionActive) return unavailable('TRANSACTION_REQUIRED');
    // The optional metadata reader can swallow a missing-table/column error.
    // Recover that failed subtransaction before an UNAVAILABLE assessment is appended.
    const savepoint = 'mf06_candidate_profile_' + randomUUID().replaceAll('-', '');
    await manager.query('SAVEPOINT ' + savepoint);
    let lookup: SafetyFaceProfileLookup | undefined;
    let metadata: ReturnType<typeof profileSchema.safeParse>;
    let optionalUnavailable = false;
    try {
      lookup = await this.profiles.findCurrentForSafety(
        manager,
        site,
        {
          profileReferenceHash: inspectedResponse.profileReferenceHash,
          profileRevision: inspectedResponse.profileRevision,
          modelVersion: invocation.modelVersion,
        },
        true,
      );
      optionalUnavailable = lookup?.state === 'UNAVAILABLE';
      metadata = profileSchema.safeParse(lookup);
      await manager.query('RELEASE SAVEPOINT ' + savepoint);
    } catch (error) {
      await manager.query('ROLLBACK TO SAVEPOINT ' + savepoint);
      await manager.query('RELEASE SAVEPOINT ' + savepoint);
      const code =
        (error as { code?: string; driverError?: { code?: string } }).code ??
        (error as { driverError?: { code?: string } }).driverError?.code;
      if (code === '25P02' && optionalUnavailable) return unavailable('PROFILE_UNAVAILABLE');
      throw error;
    }
    if (
      !metadata.success ||
      metadata.data.siteId.toLowerCase() !== site ||
      metadata.data.profileRevision.toLowerCase() !==
        inspectedResponse.profileRevision.toLowerCase()
    )
      return unavailable('PROFILE_UNAVAILABLE');
    if (!manager.queryRunner?.isTransactionActive) return unavailable('TRANSACTION_REQUIRED');
    return {
      state: 'ELIGIBLE_PROFILE_METADATA',
      provenance: inspectedResponse.provenance,
      siteId: site,
      requestId: requestKey,
      bindingDigest: invocation.bindingDigest,
      contextDigest: stored.contextDigest,
      workerId: metadata.data.workerId.toLowerCase(),
      profileId: metadata.data.profileId.toLowerCase(),
      profileRevision: metadata.data.profileRevision.toLowerCase(),
      consentId: metadata.data.consentId.toLowerCase(),
      identityEstablished: false,
      authorityEstablished: false,
    };
  }
}
