import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import { FaceProfileEntity } from '../../database/entities/face-profile.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { WorkerSiteZoneAssignmentEntity } from '../../database/entities/worker-site-zone-assignment.entity.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { WorkforceActor } from './contractor-operations.service.js';
import { authorizeGateEntry } from './gate-authorization-policy.js';
import { decideFaceGate } from './face-gate-policy.js';
import {
  FACE_ENROLLMENT_ADAPTER,
  type UploadedFaceSample,
} from './face-enrollment.service.js';
import {
  UnavailableFaceEnrollmentAdapter,
  type FaceVerificationAdapter,
} from './face-enrollment.adapter.js';

const MAX_JPEG_BYTES = 5 * 1024 * 1024;
const GATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

@Injectable()
export class FaceGateService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(FACE_ENROLLMENT_ADAPTER)
    private readonly adapter: FaceVerificationAdapter = new UnavailableFaceEnrollmentAdapter(),
  ) {}

  async verify(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    frame: UploadedFaceSample | undefined,
  ) {
    this.validateFrame(frame);
    const operatorAllowed = actor.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        (role === UserRole.ADMIN && assignedSiteId === null) ||
        (assignedSiteId === siteId &&
          (role === UserRole.SAFETY_OFFICER ||
            role === UserRole.SITE_MANAGER ||
            role === UserRole.SECURITY_OFFICER)),
    );
    if (actor.mustChangePassword || !operatorAllowed)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Gate operator access is required',
      });
    if (!GATE_ID.test(gateId))
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Invalid gate identifier',
      });
    // The gate console is an operator surface: any authenticated account with an
    // assigned site may run it; authorization of the identified worker remains
    // entirely server-side below.
    const evidence = await this.adapter.verify({ verificationId: randomUUID(), jpeg: frame.buffer });
    if (evidence.status !== 'MATCHED' || !evidence.candidateProfileReference) {
      return { decision: decideFaceGate({ technicalOutcome: evidence.status }) };
    }
    return this.dataSource.transaction(async (manager) => {
      const site = await manager.getRepository(SiteEntity).findOneBy({ id: siteId });
      if (!site)
        throw new PublicHttpException(HttpStatus.NOT_FOUND, { code: 'NOT_FOUND', message: 'Not found' });
      const profile = await manager.getRepository(FaceProfileEntity).findOneBy({
        profileReferenceHash: createHash('sha256')
          .update(evidence.candidateProfileReference!, 'utf8')
          .digest('hex'),
      });
      if (!profile) {
        return { decision: decideFaceGate({ technicalOutcome: 'UNKNOWN' }) };
      }
      if (profile.modelVersion !== evidence.modelVersion) {
        return { decision: decideFaceGate({ technicalOutcome: 'MATCHED' }) };
      }
      const worker = await manager.getRepository(WorkerEntity).findOneBy({ id: profile.workerId });
      const contractor = worker?.contractorId
        ? await manager.getRepository(ContractorEntity).findOneBy({ id: worker.contractorId })
        : null;
      const now = new Date();
      const participation = contractor
        ? await manager.getRepository(ContractorSiteParticipationEntity).findOneBy({
            contractorId: contractor.id,
            siteId,
            isActive: true,
          })
        : null;
      const assignments = worker
        ? await manager.getRepository(WorkerSiteZoneAssignmentEntity).find({
            where: { workerId: worker.id, siteId },
            order: { validFrom: 'DESC' },
          })
        : [];
      const assignment = assignments.find(
        (entry) =>
          entry.validFrom.getTime() <= now.getTime() &&
          (entry.validUntil === null || entry.validUntil.getTime() > now.getTime()),
      );
      const authorization = authorizeGateEntry({
        authorizationDataAvailable: !!worker && !!contractor,
        workerActive: worker?.isActive ?? false,
        contractorActive: contractor?.isActive ?? false,
        contractorParticipatesAtSite:
          !!participation &&
          participation.validFrom.getTime() <= now.getTime() &&
          (participation.validUntil === null || participation.validUntil.getTime() > now.getTime()),
        faceProfileStatus: profile.status,
        assignment,
        siteId,
        evaluatedAt: now,
      });
      const decision =
        authorization.authorization === 'MANUAL_REVIEW'
          ? decideFaceGate({ technicalOutcome: 'MATCHED' })
          : decideFaceGate({
              technicalOutcome: 'MATCHED',
              authorization: authorization.authorization,
              reasonCode: authorization.reasonCode,
            });
      return {
        decision,
        ...(worker
          ? {
              worker: {
                id: worker.id,
                externalId: worker.externalId,
                displayName: worker.displayName,
                contractorName: contractor?.name ?? 'Chưa gán nhà thầu',
                assignmentStatus: assignment?.status ?? 'MISSING',
              },
            }
          : {}),
      };
    });
  }

  private validateFrame(frame: UploadedFaceSample | undefined): asserts frame is UploadedFaceSample {
    if (
      !frame ||
      !Buffer.isBuffer(frame.buffer) ||
      frame.size !== frame.buffer.length ||
      frame.size < 1 ||
      frame.mimetype !== 'image/jpeg'
    )
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'A JPEG frame is required',
      });
    if (frame.size > MAX_JPEG_BYTES)
      throw new PublicHttpException(HttpStatus.PAYLOAD_TOO_LARGE, {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Face frame exceeds the size limit',
      });
  }
}
