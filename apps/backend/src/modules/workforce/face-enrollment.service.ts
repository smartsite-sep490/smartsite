import { createHash, randomUUID, randomBytes } from 'node:crypto';
import type { EnrollmentCaptureTarget } from '@smartsite/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength, Matches, Equals } from 'class-validator';
import { DataSource, In, IsNull, LessThan, MoreThan, Not, type EntityManager } from 'typeorm';
import { command, conflict, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import type { WorkerEntity } from '../../database/entities/worker.entity.js';
import {
  FaceEnrollmentSessionEntity,
  FaceEnrollmentSessionStatus,
} from '../../database/entities/face-enrollment-session.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../../database/entities/face-profile.entity.js';
import type { WorkforceActor } from './contractor-operations.service.js';
import { ContractorOperationsService } from './contractor-operations.service.js';
import { auditAccess } from './access-audit.js';
import {
  UnavailableFaceEnrollmentAdapter,
  type FaceEnrollmentAdapter,
  type FaceEnrollmentCompletion,
  type FaceSampleQuality,
} from './face-enrollment.adapter.js';

export const FACE_ENROLLMENT_ADAPTER = Symbol('FACE_ENROLLMENT_ADAPTER');

const MAX_JPEG_BYTES = 5 * 1024 * 1024;

export class StartFaceEnrollmentCommand {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  consentVersion!: string;
}

export interface UploadedFaceSample {
  mimetype: string;
  size: number;
  buffer: Buffer;
}
export class ConfirmFaceConsentCommand {
  @Matches(/^[a-f0-9]{64}$/) consentToken!: string;
  @Equals(true) workerConfirmed!: boolean;
}

@Injectable()
export class FaceEnrollmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workforce: ContractorOperationsService,
    @Inject(FACE_ENROLLMENT_ADAPTER)
    private readonly adapter: FaceEnrollmentAdapter = new UnavailableFaceEnrollmentAdapter(),
  ) {}

  private validateJpeg(
    sample: UploadedFaceSample | undefined,
  ): asserts sample is UploadedFaceSample {
    if (
      !sample ||
      !Buffer.isBuffer(sample.buffer) ||
      sample.size !== sample.buffer.length ||
      sample.size < 1
    )
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'A JPEG sample is required',
      });
    if (sample.mimetype !== 'image/jpeg')
      throw new PublicHttpException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Only JPEG face samples are accepted',
      });
    if (sample.size > MAX_JPEG_BYTES)
      throw new PublicHttpException(HttpStatus.PAYLOAD_TOO_LARGE, {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Face sample exceeds the size limit',
      });
  }

  async start(actor: WorkforceActor, workerIdValue: string, input: StartFaceEnrollmentCommand) {
    const value = command(StartFaceEnrollmentCommand, input);
    return this.dataSource.transaction(async (manager) => {
      const worker = await this.workforce.requireWorkerEnrollmentAccess(
        manager,
        actor,
        workerIdValue,
      );
      await this.requireLinkedAccount(manager, worker);
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `face-enrollment:${worker.id}`,
      ]);
      await manager.getRepository(FaceEnrollmentSessionEntity).update(
        {
          workerId: worker.id,
          status: In([FaceEnrollmentSessionStatus.PENDING, FaceEnrollmentSessionStatus.COLLECTING]),
          expiresAt: LessThan(new Date()),
        },
        { status: FaceEnrollmentSessionStatus.CANCELLED, completedAt: new Date() },
      );
      const active = await manager.getRepository(FaceEnrollmentSessionEntity).findOne({
        where: {
          workerId: worker.id,
          status: In([FaceEnrollmentSessionStatus.PENDING, FaceEnrollmentSessionStatus.COLLECTING]),
        },
      });
      if (active) conflict('An active face enrollment already exists');
      const now = new Date();
      const consentToken = randomBytes(32).toString('hex');
      const session = await manager.getRepository(FaceEnrollmentSessionEntity).save({
        id: randomUUID(),
        workerId: worker.id,
        actorUserId: actor.id,
        consentVersion: value.consentVersion,
        consentedAt: null,
        consentTokenHash: createHash('sha256').update(consentToken).digest('hex'),
        consentMethod: null,
        expiresAt: new Date(now.getTime() + 30 * 60_000),
        status: FaceEnrollmentSessionStatus.PENDING,
        acceptedSampleCount: 0,
        startedAt: now,
        completedAt: null,
      });
      return { ...session, consentToken };
    });
  }
  async confirmConsent(sessionIdValue: string, input: ConfirmFaceConsentCommand) {
    const value = command(ConfirmFaceConsentCommand, input);
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.getRepository(FaceEnrollmentSessionEntity).findOne({
        where: {
          id: uuid(sessionIdValue),
          consentTokenHash: createHash('sha256').update(value.consentToken).digest('hex'),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) missing();
      if (
        !session.expiresAt ||
        session.expiresAt <= new Date() ||
        session.status !== FaceEnrollmentSessionStatus.PENDING
      )
        conflict('Consent session is unavailable');
      if (session.consentedAt) return session;
      session.consentedAt = new Date();
      session.consentMethod = 'SUPERVISED_WORKER_CONFIRMATION';
      await auditAccess(
        manager,
        null,
        null,
        'WORKER_FACE_CONSENT_CONFIRMED',
        'face_enrollment_session',
        session.id,
        'Worker personal confirmation',
        {
          workerId: session.workerId,
          consentVersion: session.consentVersion,
          method: session.consentMethod,
        },
      );
      return manager.getRepository(FaceEnrollmentSessionEntity).save(session);
    });
  }

  async cancel(actor: WorkforceActor, sessionIdValue: string) {
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.getRepository(FaceEnrollmentSessionEntity).findOne({
        where: { id: uuid(sessionIdValue), actorUserId: actor.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) missing();
      await this.workforce.requireWorkerEnrollmentAccess(manager, actor, session.workerId);
      if (
        [FaceEnrollmentSessionStatus.PENDING, FaceEnrollmentSessionStatus.COLLECTING].includes(
          session.status,
        )
      ) {
        session.status = FaceEnrollmentSessionStatus.CANCELLED;
        session.completedAt = new Date();
        await manager.getRepository(FaceEnrollmentSessionEntity).save(session);
      }
      return session;
    });
  }

  async getProfile(actor: WorkforceActor, workerIdValue: string): Promise<FaceProfileEntity> {
    return this.dataSource.transaction(async (manager) => {
      const worker = await this.workforce.requireWorkerEnrollmentAccess(
        manager,
        actor,
        workerIdValue,
      );
      const profile = await manager
        .getRepository(FaceProfileEntity)
        .findOne({ where: { workerId: worker.id }, order: { createdAt: 'DESC', id: 'DESC' } });
      if (!profile) missing();
      return profile;
    });
  }

  async revokeProfile(
    actor: WorkforceActor,
    workerIdValue: string,
    erase = false,
  ): Promise<FaceProfileEntity> {
    return this.dataSource.transaction(async (manager) => {
      const worker = await this.workforce.requireWorkerEnrollmentAccess(
        manager,
        actor,
        workerIdValue,
      );
      const profile = await manager
        .getRepository(FaceProfileEntity)
        .createQueryBuilder('profile')
        .setLock('pessimistic_write')
        .where('profile.worker_id = :workerId', { workerId: worker.id })
        .orderBy('profile.created_at', 'DESC')
        .addOrderBy('profile.id', 'DESC')
        .getOne();
      if (!profile) missing();
      if (
        profile.status === FaceProfileStatus.DELETED ||
        (!erase && profile.status === FaceProfileStatus.REVOKED)
      )
        return profile;
      profile.status = erase ? FaceProfileStatus.DELETED : FaceProfileStatus.REVOKED;
      profile.revokedAt = new Date();
      profile.revokedByUserId = actor.id;
      profile.encryptedTemplate = null;
      profile.deletedAt = new Date();
      await auditAccess(
        manager,
        actor.id,
        worker.siteId,
        erase ? 'FACE_TEMPLATE_DELETED' : 'FACE_CONSENT_REVOKED',
        'face_profile',
        profile.id,
        null,
        { workerId: worker.id, status: profile.status },
      );
      return manager.getRepository(FaceProfileEntity).save(profile);
    });
  }

  async submitSample(
    actor: WorkforceActor,
    sessionIdValue: string,
    sample: UploadedFaceSample | undefined,
  ): Promise<FaceEnrollmentSessionEntity> {
    this.validateJpeg(sample);
    const sessionId = uuid(sessionIdValue);
    const session = await this.dataSource.transaction(async (manager) =>
      this.requireOpenSession(manager, actor, sessionId),
    );
    // Never put jpeg bytes in a transaction, database entity, application log, or browser storage.
    const result = await this.adapter.submitSample({
      sessionId: session.id,
      sampleIndex: session.acceptedSampleCount + 1,
      jpeg: sample.buffer,
    });
    if (
      !Number.isSafeInteger(result.acceptedSampleCount) ||
      result.acceptedSampleCount !== session.acceptedSampleCount + 1 ||
      result.acceptedSampleCount > 3
    )
      throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Face verification returned an invalid enrollment result',
      });
    return this.dataSource.transaction(async (manager) => {
      const current = await this.requireOpenSession(manager, actor, session.id, true);
      if (current.acceptedSampleCount !== session.acceptedSampleCount)
        conflict('Face enrollment sample is no longer current');
      current.acceptedSampleCount = result.acceptedSampleCount;
      current.status = FaceEnrollmentSessionStatus.COLLECTING;
      return manager.getRepository(FaceEnrollmentSessionEntity).save(current);
    });
  }

  async assessSampleQuality(
    actor: WorkforceActor,
    workerIdValue: string,
    sample: UploadedFaceSample | undefined,
    target: EnrollmentCaptureTarget,
  ): Promise<FaceSampleQuality> {
    this.validateJpeg(sample);
    await this.dataSource.transaction(async (manager) => {
      const worker = await this.workforce.requireWorkerEnrollmentAccess(
        manager,
        actor,
        workerIdValue,
      );
      if (
        !(await manager.getRepository(FaceEnrollmentSessionEntity).existsBy({
          workerId: worker.id,
          actorUserId: actor.id,
          consentedAt: Not(IsNull()),
          expiresAt: MoreThan(new Date()),
          status: In([FaceEnrollmentSessionStatus.PENDING, FaceEnrollmentSessionStatus.COLLECTING]),
        }))
      )
        conflict('Worker consent is required before face quality assessment');
    });
    if (!['front', 'left', 'right'].includes(target))
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Invalid face capture target',
      });
    const result = await this.adapter.assessSampleQuality(sample.buffer, target);
    if (result.status === 'AI_UNAVAILABLE')
      throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Face quality check is temporarily unavailable',
      });
    return result;
  }

  async complete(actor: WorkforceActor, sessionIdValue: string): Promise<FaceProfileEntity> {
    const sessionId = uuid(sessionIdValue);
    const session = await this.dataSource.transaction(async (manager) =>
      this.requireOpenSession(manager, actor, sessionId),
    );
    if (session.acceptedSampleCount !== 3)
      conflict('Face enrollment requires three accepted samples');
    let completion: FaceEnrollmentCompletion;
    try {
      completion = await this.adapter.completeEnrollment(session.id);
      this.validateCompletion(completion);
    } catch (error) {
      // A quality/model failure must not leave the session active forever;
      // callers can capture a fresh three-sample session and retry.
      await this.markSessionFailed(actor, session.id);
      throw error;
    }
    return this.dataSource.transaction(async (manager) => {
      const current = await this.requireOpenSession(manager, actor, session.id, true);
      if (current.acceptedSampleCount !== 3)
        conflict('Face enrollment requires three accepted samples');
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `face-enrollment:${current.workerId}`,
      ]);
      const profileReferenceHash = createHash('sha256')
        .update(completion.profileReference, 'utf8')
        .digest('hex');
      const existing = await manager
        .getRepository(FaceProfileEntity)
        .createQueryBuilder('profile')
        .setLock('pessimistic_write')
        .where('profile.worker_id = :workerId', { workerId: current.workerId })
        .andWhere('profile.status = :status', { status: FaceProfileStatus.ACTIVE })
        .getOne();
      const now = new Date();
      if (existing?.status === FaceProfileStatus.ACTIVE) {
        existing.status = FaceProfileStatus.REVOKED;
        existing.revokedAt = now;
        existing.revokedByUserId = actor.id;
        existing.encryptedTemplate = null;
        existing.deletedAt = now;
        await manager.getRepository(FaceProfileEntity).save(existing);
      }
      const profile = manager.getRepository(FaceProfileEntity).create({ id: randomUUID() });
      const worker = await this.workforce.requireWorkerEnrollmentAccess(
        manager,
        actor,
        current.workerId,
      );
      await this.requireLinkedAccount(manager, worker);
      profile.workerId = current.workerId;
      profile.userId = worker.userId;
      profile.encryptedTemplate = completion.encryptedTemplate;
      profile.profileReferenceHash = profileReferenceHash;
      profile.modelVersion = completion.modelVersion;
      profile.status = FaceProfileStatus.ACTIVE;
      profile.consentVersion = current.consentVersion;
      if (!current.consentedAt || !current.consentMethod) conflict('Worker consent is required');
      profile.consentedAt = current.consentedAt;
      profile.consentMethod = current.consentMethod;
      profile.deletedAt = null;
      profile.createdByUserId = actor.id;
      profile.revokedAt = null;
      profile.revokedByUserId = null;
      current.status = FaceEnrollmentSessionStatus.COMPLETED;
      current.completedAt = now;
      await manager.getRepository(FaceEnrollmentSessionEntity).save(current);
      await auditAccess(
        manager,
        actor.id,
        worker.siteId,
        'FACE_PROFILE_ACTIVATED',
        'face_profile',
        profile.id,
        null,
        {
          workerId: worker.id,
          modelVersion: profile.modelVersion,
          consentMethod: profile.consentMethod,
          consentVersion: profile.consentVersion,
        },
      );
      return manager.getRepository(FaceProfileEntity).save(profile);
    });
  }

  private async markSessionFailed(actor: WorkforceActor, sessionId: string): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const current = await this.requireOpenSession(manager, actor, sessionId, true);
        current.status = FaceEnrollmentSessionStatus.FAILED;
        current.completedAt = new Date();
        await manager.getRepository(FaceEnrollmentSessionEntity).save(current);
      });
    } catch {
      // Preserve the adapter/validation error returned to the caller.
    }
  }

  private validateCompletion(completion: FaceEnrollmentCompletion): void {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(completion.profileReference) ||
      !/^[^\p{Cc}\p{Cs}]{1,128}$/u.test(completion.modelVersion) ||
      !/^[A-Za-z0-9_-]{100,32766}={0,2}$/.test(completion.encryptedTemplate)
    )
      throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Face verification returned an invalid enrollment result',
      });
  }

  private async requireOpenSession(
    manager: EntityManager,
    actor: WorkforceActor,
    sessionId: string,
    lock = false,
  ): Promise<FaceEnrollmentSessionEntity> {
    const session = lock
      ? await manager
          .getRepository(FaceEnrollmentSessionEntity)
          .createQueryBuilder('session')
          .setLock('pessimistic_write')
          .where('session.id = :sessionId', { sessionId })
          .getOne()
      : await manager.getRepository(FaceEnrollmentSessionEntity).findOneBy({ id: sessionId });
    if (!session) missing();
    if (
      !session.consentedAt ||
      !session.consentMethod ||
      !session.expiresAt ||
      session.expiresAt <= new Date()
    )
      conflict('Worker must confirm consent before face capture');
    if (session.actorUserId !== actor.id)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Use your own enrollment session',
      });
    const worker = await this.workforce.requireWorkerEnrollmentAccess(
      manager,
      actor,
      session.workerId,
    );
    await this.requireLinkedAccount(manager, worker);
    if (
      session.status !== FaceEnrollmentSessionStatus.PENDING &&
      session.status !== FaceEnrollmentSessionStatus.COLLECTING
    )
      conflict('Face enrollment is not open');
    return session;
  }

  private async requireLinkedAccount(manager: EntityManager, worker: WorkerEntity) {
    if (!worker.userId) return;
    const user = await manager
      .getRepository(UserEntity)
      .findOneBy({ id: worker.userId, isActive: true });
    const role = await manager.getRepository(UserRoleAssignmentEntity).findOneBy([
      { userId: worker.userId, siteId: worker.siteId },
      { userId: worker.userId, siteId: IsNull(), role: UserRole.ADMIN },
    ]);
    if (!user || !role) conflict('The linked account must be active and assigned to this site');
  }
}
