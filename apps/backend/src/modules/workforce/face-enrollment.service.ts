import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';
import { DataSource, In, IsNull, type EntityManager } from 'typeorm';
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
      const active = await manager.getRepository(FaceEnrollmentSessionEntity).findOne({
        where: {
          workerId: worker.id,
          status: In([FaceEnrollmentSessionStatus.PENDING, FaceEnrollmentSessionStatus.COLLECTING]),
        },
      });
      if (active) conflict('An active face enrollment already exists');
      const now = new Date();
      return manager.getRepository(FaceEnrollmentSessionEntity).save({
        id: randomUUID(),
        workerId: worker.id,
        actorUserId: actor.id,
        consentVersion: value.consentVersion,
        consentedAt: now,
        status: FaceEnrollmentSessionStatus.PENDING,
        acceptedSampleCount: 0,
        startedAt: now,
        completedAt: null,
      });
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
        .findOneBy({ workerId: worker.id });
      if (!profile) missing();
      return profile;
    });
  }

  async revokeProfile(actor: WorkforceActor, workerIdValue: string): Promise<FaceProfileEntity> {
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
        .getOne();
      if (!profile) missing();
      if (profile.status === FaceProfileStatus.REVOKED) return profile;
      profile.status = FaceProfileStatus.REVOKED;
      profile.revokedAt = new Date();
      profile.revokedByUserId = actor.id;
      profile.encryptedTemplate = null;
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
  ): Promise<FaceSampleQuality> {
    this.validateJpeg(sample);
    await this.dataSource.transaction(async (manager) => {
      await this.workforce.requireWorkerEnrollmentAccess(manager, actor, workerIdValue);
    });
    const result = await this.adapter.assessSampleQuality(sample.buffer);
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
      const profileReferenceHash = createHash('sha256')
        .update(completion.profileReference, 'utf8')
        .digest('hex');
      const existing = await manager
        .getRepository(FaceProfileEntity)
        .createQueryBuilder('profile')
        .setLock('pessimistic_write')
        .where('profile.worker_id = :workerId', { workerId: current.workerId })
        .getOne();
      const now = new Date();
      const profile =
        existing ?? manager.getRepository(FaceProfileEntity).create({ id: randomUUID() });
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
      profile.consentedAt = current.consentedAt;
      profile.createdByUserId = actor.id;
      profile.revokedAt = null;
      profile.revokedByUserId = null;
      current.status = FaceEnrollmentSessionStatus.COMPLETED;
      current.completedAt = now;
      await manager.getRepository(FaceEnrollmentSessionEntity).save(current);
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
    if (!worker.userId) conflict('Link an account before enrolling a face');
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
