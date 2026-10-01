import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { FaceGateVerificationResponse, GateAccessLogResponse } from '@smartsite/contracts';
import { GateAccessLogEntity } from '../../database/entities/gate-access-log.entity.js';
import { uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../../database/entities/face-profile.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { WorkerSiteZoneAssignmentEntity } from '../../database/entities/worker-site-zone-assignment.entity.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import type { WorkforceActor } from './contractor-operations.service.js';
import { authorizeGateEntry } from './gate-authorization-policy.js';
import { decideFaceGate } from './face-gate-policy.js';
import { FACE_ENROLLMENT_ADAPTER, type UploadedFaceSample } from './face-enrollment.service.js';
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
    direction: 'IN' | 'OUT' = 'IN',
  ): Promise<FaceGateVerificationResponse> {
    await this.requireOperator(actor, siteId, gateId);
    if (direction !== 'IN' && direction !== 'OUT')
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Invalid gate direction',
      });
    const result = await this.evaluate(siteId, gateId, frame);
    // Unidentified scans carry no business identity and are not retained.
    if (!result.worker) return result;
    // A decision is acknowledged only after its audit record is durably stored.
    const log = await this.dataSource.getRepository(GateAccessLogEntity).save({
      id: randomUUID(),
      siteId,
      gateId,
      operatorUserId: actor.id,
      direction,
      workerId: result.worker?.id ?? null,
      userId: result.worker?.userId ?? null,
      workerName: result.worker?.displayName ?? null,
      workerExternalId: result.worker?.externalId ?? null,
      contractorName: result.worker?.contractorName ?? null,
      username: result.worker?.username ?? null,
      decision: result.decision,
    });
    return { ...result, log: this.logResponse(log) };
  }

  async listLogs(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
  ): Promise<{ items: GateAccessLogResponse[] }> {
    await this.requireOperator(actor, siteId, gateId);
    const logs = await this.dataSource.getRepository(GateAccessLogEntity).find({
      where: { siteId, gateId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 50,
    });
    return { items: logs.map((log) => this.logResponse(log)) };
  }

  private logResponse(log: GateAccessLogEntity): GateAccessLogResponse {
    return {
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      gateId: log.gateId,
      direction: log.direction,
      workerId: log.workerId,
      userId: log.userId,
      workerName: log.workerName,
      workerExternalId: log.workerExternalId,
      contractorName: log.contractorName,
      username: log.username,
      decision: log.decision,
    };
  }

  private async requireOperator(actor: WorkforceActor, siteId: string, gateId: string) {
    uuid(siteId);
    const allowed = actor.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        (role === UserRole.ADMIN && assignedSiteId === null) ||
        (assignedSiteId === siteId &&
          [UserRole.SAFETY_OFFICER, UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER].includes(
            role,
          )),
    );
    if (actor.mustChangePassword || !allowed)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Gate operator access is required',
      });
    if (!GATE_ID.test(gateId))
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Invalid gate identifier',
      });
    if (!(await this.dataSource.getRepository(SiteEntity).existsBy({ id: siteId })))
      throw new PublicHttpException(HttpStatus.NOT_FOUND, {
        code: 'NOT_FOUND',
        message: 'Not found',
      });
  }

  private async evaluate(siteId: string, gateId: string, frame: UploadedFaceSample | undefined) {
    this.validateFrame(frame);
    // Only authorized site operators may scan; account linkage does not grant
    // gate access. Authorization of the identified worker remains server-side.
    const templates = await this.dataSource
      .getRepository(FaceProfileEntity)
      .createQueryBuilder('profile')
      .innerJoin(
        WorkerEntity,
        'worker',
        'worker.id = profile.worker_id AND worker.user_id = profile.user_id',
      )
      .innerJoin(UserEntity, 'account', 'account.id = profile.user_id AND account.is_active = TRUE')
      .select('profile.profile_reference_hash', 'profileReferenceHash')
      .addSelect('profile.encrypted_template', 'encryptedTemplate')
      .where('worker.site_id = :siteId AND worker.is_active = TRUE', { siteId })
      .andWhere(
        "EXISTS (SELECT 1 FROM user_role_assignment role WHERE role.user_id = account.id AND (role.site_id = worker.site_id OR (role.role = 'ADMIN' AND role.site_id IS NULL)))",
      )
      .andWhere('profile.status = :status AND profile.encrypted_template IS NOT NULL', {
        status: FaceProfileStatus.ACTIVE,
      })
      .orderBy('profile.id', 'ASC')
      .limit(1001)
      .getRawMany<{ profileReferenceHash: string; encryptedTemplate: string }>();
    if (templates.length > 1000)
      return { decision: decideFaceGate({ technicalOutcome: 'AI_UNAVAILABLE' }) };
    const evidence = await this.adapter.verify({
      verificationId: randomUUID(),
      jpeg: frame.buffer,
      templates,
    });
    if (evidence.status !== 'MATCHED' || !evidence.candidateProfileReference) {
      return { decision: decideFaceGate({ technicalOutcome: evidence.status }) };
    }
    return this.dataSource.transaction(async (manager) => {
      const site = await manager.getRepository(SiteEntity).findOneBy({ id: siteId });
      if (!site)
        throw new PublicHttpException(HttpStatus.NOT_FOUND, {
          code: 'NOT_FOUND',
          message: 'Not found',
        });
      const profile = await manager.getRepository(FaceProfileEntity).findOneBy({
        profileReferenceHash: createHash('sha256')
          .update(evidence.candidateProfileReference!, 'utf8')
          .digest('hex'),
      });
      if (
        !profile ||
        !templates.some(
          (template) => template.profileReferenceHash === profile.profileReferenceHash,
        )
      ) {
        return { decision: decideFaceGate({ technicalOutcome: 'UNKNOWN' }) };
      }
      if (profile.modelVersion !== evidence.modelVersion) {
        return { decision: decideFaceGate({ technicalOutcome: 'MATCHED' }) };
      }
      const worker = await manager.getRepository(WorkerEntity).findOneBy({ id: profile.workerId });
      const account = profile.userId
        ? await manager.getRepository(UserEntity).findOneBy({ id: profile.userId, isActive: true })
        : null;
      const accountRole = account
        ? await manager.getRepository(UserRoleAssignmentEntity).findOneBy([
            { userId: account.id, siteId },
            { userId: account.id, siteId: IsNull(), role: UserRole.ADMIN },
          ])
        : null;
      if (
        !worker ||
        worker.siteId !== siteId ||
        worker.userId !== profile.userId ||
        !account ||
        !accountRole ||
        profile.status !== FaceProfileStatus.ACTIVE
      ) {
        return { decision: decideFaceGate({ technicalOutcome: 'UNKNOWN' }) };
      }
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
          (entry.gateId === null || entry.gateId === gateId) &&
          entry.status === 'APPROVED' &&
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
        gateId,
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
                userId: account.id,
                username: account.username,
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

  private validateFrame(
    frame: UploadedFaceSample | undefined,
  ): asserts frame is UploadedFaceSample {
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
