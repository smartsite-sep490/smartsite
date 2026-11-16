import { lockC02EvidenceStaging } from './c02-evidence-inventory.js';
import { Injectable } from '@nestjs/common';
import {
  computeCanonicalPayloadHash,
  SAFETY_IDENTIFICATION_OUTCOMES,
  SAFETY_IDENTIFICATION_STATUSES,
  type SafetyIdentificationAssignee,
  type SafetyIdentificationOutcome,
  type SafetyIdentificationHistoryEntry,
  type SafetyIdentificationHistoryPage,
  type SafetyIdentificationRequest,
} from '@smartsite/contracts';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  Max,
  Min,
  ValidateIf,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import { DataSource, type EntityManager } from 'typeorm';
import {
  command,
  conflict,
  invalid,
  missing,
  uuid,
} from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyAlertEvidenceService } from '../alerts/safety-alert-evidence.service.js';
import { cropSafetySubjectFrame } from '../identity/safety-subject-cropper.js';
import { selectObservationSubject } from '../identity/observation-identity-subject.js';
import { TrackedEpisodeFrameQuery } from '../alerts/tracked-episode-frame-query.js';
import {
  parseEvidencePreviewInput,
  renderEvidencePreview,
} from './safety-identification-evidence-preview.js';

class CreateIdentificationDto {
  @Allow() evidenceApproval?: unknown;
  @IsUUID() commandId!: string;
  @IsUUID() episodeId!: string;
  @IsUUID() assignedTo!: string;
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) dueAt?:
    string | null;
  @IsArray() @ArrayMaxSize(32) @IsUUID(undefined, { each: true }) evidenceRefs!: string[];
}

class VersionDto {
  @IsUUID() commandId!: string;
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

class RespondDto extends VersionDto {
  @IsIn(SAFETY_IDENTIFICATION_OUTCOMES) outcome!: SafetyIdentificationOutcome;
  @ValidateIf((_, value) => value !== null) @IsUUID() workerId!: string | null;
  @ValidateIf((_, value) => value !== null) @IsUUID() contractorId!: string | null;
  @IsArray() @ArrayMaxSize(32) @IsUUID(undefined, { each: true }) evidenceRefs!: string[];
}

class ReviewDto extends VersionDto {
  @IsIn(['ACCEPT', 'RETURN']) decision!: 'ACCEPT' | 'RETURN';
}

class ReassignDto extends VersionDto {
  @IsUUID() assignedTo!: string;
}

const mutationDtos = {
  respond: RespondDto,
  review: ReviewDto,
  reassign: ReassignDto,
  cancel: VersionDto,
};
export type IdentificationAction = keyof typeof mutationDtos;
interface RequestRow {
  published_evidence?: unknown;
  current_result_id: string | null;
  current_result: SafetyIdentificationRequest['result'];
  id: string;
  site_id: string;
  episode_id: string;
  assigned_to: string;
  requested_by: string;
  status: SafetyIdentificationRequest['status'];
  version: number;
  reason: string;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
  event_id: string;
  person_observation_index: number;
  subject_kind: 'EVENT_LOCAL' | 'TRACKED';
  tracking_segment_id: string | null;
  tracking_scope_sha256: string | null;
}

const eligibleSiteManager = `FROM app_user u JOIN user_role_assignment r ON r.user_id=u.id
  WHERE r.site_id=$1 AND r.role='SITE_MANAGER' AND u.is_active AND NOT u.must_change_password`;

const requestSelect = `SELECT r.*,e.event_id,e.person_observation_index,e.subject_kind,
  e.tracking_segment_id,e.tracking_scope_sha256,a.result->'result' AS current_result,
  publication.payload->'publishedEvidence' AS published_evidence FROM safety_identification_request r
  JOIN safety_episode e ON (e.id,e.site_id)=(r.episode_id,r.site_id)
  LEFT JOIN safety_identification_action a ON (a.command_id,a.request_id,a.site_id)=(r.current_result_id,r.id,r.site_id)
  LEFT JOIN safety_identification_action publication
    ON publication.request_id=r.id AND publication.site_id=r.site_id
    AND publication.actor_user_id=r.requested_by AND publication.request_version=1 AND publication.kind='CREATE'`;

const evidenceAvailability = {
  status: 'UNAVAILABLE',
  reason: 'SUBJECT_DERIVATIVE_UNAVAILABLE',
} as const;

const publishedEvidence = z
  .array(
    z.object({
      id: z.uuid(),
      sourceEventId: z.uuid(),
      personObservationIndex: z.number().int().nonnegative(),
      sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
      transformVersion: z.literal('REVIEWED_SUBJECT_JPEG_V1'),
      expiresAt: z.iso.datetime(),
      object: z.object({
        storageProvider: z.enum(['LOCAL', 'R2']),
        storageKey: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        size: z.number().int().min(4).max(1_048_576),
        mediaType: z.literal('image/jpeg'),
      }),
    }),
  )
  .max(32);

function response(row: RequestRow): SafetyIdentificationRequest {
  const subject =
    row.subject_kind === 'TRACKED'
      ? {
          kind: 'TRACKED' as const,
          segmentId: row.tracking_segment_id!,
          scopeSha256: row.tracking_scope_sha256!,
        }
      : {
          kind: 'EVENT_LOCAL' as const,
          eventId: row.event_id,
          personObservationIndex: row.person_observation_index,
        };
  const published = publishedEvidence.safeParse(row.published_evidence);
  const refs =
    row.status !== 'CANCELLED' && published.success
      ? published.data
          .filter((item) => Date.parse(item.expiresAt) > Date.now())
          .map((item) => item.id)
      : [];
  return {
    id: row.id,
    siteId: row.site_id,
    episodeId: row.episode_id,
    subject,
    assignedTo: row.assigned_to,
    requestedBy: row.requested_by,
    status: row.status,
    version: row.version,
    reason: row.reason,
    dueAt: row.due_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    evidenceRefs: refs,
    evidenceAvailability: refs.length
      ? { status: 'AVAILABLE', reason: null }
      : evidenceAvailability,
    result: row.current_result,
  };
}

function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}

@Injectable()
export class SafetyIdentificationService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: UserAuthGuard,
    private readonly storage: StorageService,
    private readonly trackedFrames: TrackedEpisodeFrameQuery,
    private readonly alertEvidence: SafetyAlertEvidenceService,
  ) {}

  private async actor(manager: EntityManager, request: AuthenticatedRequest, siteId: string) {
    await this.auth.authenticateRequest(request, manager);
    const user = request.user!;
    if (user.mustChangePassword) forbidden();
    const roles: { role: string }[] = await manager.query(
      `SELECT role FROM user_role_assignment WHERE user_id=$1 AND site_id=$2
       AND role IN ('SAFETY_OFFICER','SITE_MANAGER') FOR SHARE`,
      [user.id, siteId],
    );
    if (!roles.length) forbidden();
    const [storage] = await manager.query(
      "SELECT to_regclass('safety_identification_request') IS NOT NULL AS available",
    );
    if (!storage?.available)
      throw new PublicHttpException(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Identification requests are unavailable',
      });
    return {
      id: user.id,
      officer: roles.some(({ role }) => role === 'SAFETY_OFFICER'),
      siteManager: roles.some(({ role }) => role === 'SITE_MANAGER'),
    };
  }

  async assignee(
    request: AuthenticatedRequest,
    siteValue: string,
  ): Promise<SafetyIdentificationAssignee | null> {
    const siteId = uuid(siteValue).toLowerCase();
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, request, siteId);
      if (!actor.officer) forbidden();
      const [candidate]: SafetyIdentificationAssignee[] = await manager.query(
        'SELECT u.id,u.display_name AS "displayName" ' +
          eligibleSiteManager +
          ' AND u.id<>$2 FOR SHARE OF u,r',
        [siteId, actor.id],
      );
      return candidate ?? null;
    });
  }

  async create(request: AuthenticatedRequest, siteValue: string, body: unknown) {
    const siteId = uuid(siteValue).toLowerCase();
    const input = command(CreateIdentificationDto, body);
    const reason = input.reason.trim();
    if (!reason) invalid('A reason is required');
    if (input.evidenceRefs.length) invalid('Request evidence is unavailable');
    const approval =
      input.evidenceApproval === undefined
        ? null
        : z
            .strictObject({
              preview: z.unknown(),
              frameSha256: z.string().regex(/^[0-9a-f]{64}$/),
              sha256: z.string().regex(/^[0-9a-f]{64}$/),
            })
            .safeParse(input.evidenceApproval);
    if (approval && !approval.success) invalid('Invalid evidence approval');
    const reviewed = approval?.data
      ? { ...approval.data, preview: parseEvidencePreviewInput(approval.data.preview) }
      : null;
    if (reviewed && reviewed.preview.episodeId.toLowerCase() !== input.episodeId.toLowerCase())
      invalid('Evidence must belong to the requested episode');
    const payload = {
      episodeId: input.episodeId.toLowerCase(),
      assignedTo: input.assignedTo.toLowerCase(),
      reason,
      dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
      ...(reviewed ? { evidenceApproval: reviewed } : {}),
    };
    const commandId = input.commandId.toLowerCase();
    const hashFor = (actorId: string) =>
      computeCanonicalPayloadHash({ siteId, actorId, kind: 'CREATE', payload });
    const readReceipt = async (manager: EntityManager, hash: string) => {
      const [previous] = await manager.query(
        'SELECT request_hash,result FROM safety_identification_action WHERE command_id=$1',
        [commandId],
      );
      if (!previous) return null;
      if (previous.request_hash !== hash) conflict('Identification command already used');
      return {
        request: {
          ...(previous.result as SafetyIdentificationRequest),
          evidenceRefs: [],
          evidenceAvailability,
        },
        replayed: true,
      };
    };
    let stored: Awaited<ReturnType<StorageService['save']>> | undefined;
    let commitAttempted = false;
    try {
      const prepared =
        reviewed &&
        (await (async () => {
          const previous = await this.db.transaction(async (manager) => {
            const actor = await this.actor(manager, request, siteId);
            if (!actor.officer) forbidden();
            return readReceipt(manager, hashFor(actor.id));
          });
          if (previous) return { kind: 'replay', previous } as const;
          const preview = await this.prepareEvidencePreview(request, siteId, reviewed.preview);
          if (preview.sha256 !== reviewed.sha256 || preview.frameSha256 !== reviewed.frameSha256)
            conflict('Evidence changed since preview');
          stored = await this.storage.save(preview.bytes, 'image/jpeg', 'jpg', 'c02-evidence');
          return { kind: 'prepared', preview, object: stored } as const;
        })());
      if (prepared && prepared.kind === 'replay') return prepared.previous;
      return await this.db.transaction(async (manager) => {
        const actor = await this.actor(manager, request, siteId);
        if (!actor.officer) forbidden();
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'safety-identification:' + commandId,
        ]);
        const hash = hashFor(actor.id);
        const previous = await readReceipt(manager, hash);
        if (previous) return previous;
        const [episode] = await manager.query(
          'SELECT id FROM safety_episode WHERE id=$1 AND site_id=$2 FOR UPDATE',
          [payload.episodeId, siteId],
        );
        if (!episode) missing();
        await this.requireAssignee(manager, siteId, payload.assignedTo, actor.id);
        const id = randomUUID();
        const inserted: { id: string }[] = await manager.query(
          `WITH created AS (
           INSERT INTO safety_identification_request(id,site_id,episode_id,assigned_to,requested_by,reason,due_at)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(episode_id) WHERE status IN ('OPEN','RESPONDED') DO NOTHING RETURNING id
         ) SELECT id FROM created`,
          [id, siteId, payload.episodeId, payload.assignedTo, actor.id, reason, payload.dueAt],
        );
        if (!inserted.length) conflict('An active identification request already exists');
        const [row]: RequestRow[] = await manager.query(requestSelect + ' WHERE r.id=$1', [id]);
        const publications = [];
        if (prepared && prepared.kind === 'prepared' && reviewed) {
          if ((await lockC02EvidenceStaging(manager, prepared.object)) !== false)
            conflict('Staged evidence has expired');
          const current = await this.readPreviewScope(
            request,
            siteId,
            payload.episodeId,
            reviewed.preview,
            manager,
          );
          if (!isDeepStrictEqual(current, prepared.preview.scope)) missing();
          publications.push({
            id: randomUUID(),
            sourceEventId: reviewed.preview.eventId.toLowerCase(),
            personObservationIndex: reviewed.preview.personObservationIndex,
            sourceSha256: prepared.preview.frameSha256,
            transformVersion: 'REVIEWED_SUBJECT_JPEG_V1',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            object: prepared.object,
          });
        }
        const result = response({ ...row!, published_evidence: publications });
        await manager.query(
          `INSERT INTO safety_identification_action(command_id,request_id,site_id,actor_user_id,request_version,kind,request_hash,payload,result)
         VALUES($1,$2,$3,$4,1,'CREATE',$5,$6,$7)`,
          [
            commandId,
            id,
            siteId,
            actor.id,
            hash,
            { ...payload, publishedEvidence: publications },
            result,
          ],
        );
        commitAttempted = true;
        return { request: result, replayed: false };
      });
    } finally {
      if (stored && !commitAttempted) await this.storage.remove(stored);
    }
  }

  private async requireAssignee(
    manager: EntityManager,
    siteId: string,
    assignedTo: string,
    actorId: string,
  ) {
    const [assignee] = await manager.query(
      'SELECT u.id ' + eligibleSiteManager + ' AND u.id=$2 FOR SHARE OF u,r',
      [siteId, assignedTo],
    );
    if (!assignee || assignee.id === actorId) invalid('Select the current Site Manager');
  }

  async change(
    request: AuthenticatedRequest,
    siteValue: string,
    idValue: string,
    action: IdentificationAction,
    body: unknown,
  ) {
    const siteId = uuid(siteValue).toLowerCase();
    const id = uuid(idValue).toLowerCase();
    const input = command<VersionDto>(mutationDtos[action], body);
    const reason = input.reason.trim();
    if (!reason) invalid('A reason is required');
    const commandId = input.commandId.toLowerCase();
    const proposal =
      input instanceof RespondDto
        ? {
            outcome: input.outcome,
            workerId: input.workerId?.toLowerCase() ?? null,
            contractorId: input.contractorId?.toLowerCase() ?? null,
            evidenceRefs: input.evidenceRefs,
          }
        : null;
    if (
      proposal &&
      (proposal.evidenceRefs.length ||
        (proposal.outcome === 'IDENTIFIED') !== Boolean(proposal.workerId) ||
        (proposal.contractorId &&
          proposal.outcome !== 'IDENTIFIED' &&
          proposal.outcome !== 'PARTIAL'))
    )
      invalid('Invalid identification proposal');
    const nextAssignee = input instanceof ReassignDto ? input.assignedTo.toLowerCase() : null;
    const kind = input instanceof ReviewDto ? input.decision : action.toUpperCase();
    const payload = { expectedVersion: input.expectedVersion, reason, proposal, nextAssignee };

    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, request, siteId);
      if (action !== 'respond' && !actor.officer) forbidden();
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'safety-identification:' + commandId,
      ]);
      const scope = ' WHERE r.site_id=$1 AND r.id=$2 AND ($3 OR r.assigned_to=$4)';
      const params = [siteId, id, action !== 'respond' && actor.officer, actor.id];
      const [locked] = await manager.query(
        'SELECT r.id FROM safety_identification_request r' + scope + ' FOR UPDATE',
        params,
      );
      if (!locked) missing();
      const [row]: RequestRow[] = await manager.query(requestSelect + scope, params);
      if (!row) missing();
      if (action === 'respond') {
        if (!actor.siteManager || row.requested_by === actor.id) forbidden();
      }
      const hash = computeCanonicalPayloadHash({ siteId, id, actorId: actor.id, kind, payload });
      const [previous] = await manager.query(
        'SELECT request_hash,result FROM safety_identification_action WHERE command_id=$1',
        [commandId],
      );
      if (previous) {
        if (previous.request_hash !== hash) conflict('Identification command already used');
        return {
          request: {
            ...(previous.result as SafetyIdentificationRequest),
            evidenceRefs: [],
            evidenceAvailability,
          },
          replayed: true,
        };
      }
      if (row.version !== input.expectedVersion || row.version === 2147483647)
        conflict('Identification request version changed');
      const expectedStatus =
        action === 'respond' ? 'OPEN' : action === 'review' ? 'RESPONDED' : null;
      if (
        row.status === 'CLOSED' ||
        row.status === 'CANCELLED' ||
        (expectedStatus && row.status !== expectedStatus)
      )
        conflict('Identification request state changed');
      if (nextAssignee) {
        await this.requireAssignee(manager, siteId, nextAssignee, actor.id);
        if (nextAssignee === row.requested_by || nextAssignee === row.assigned_to)
          invalid('Select a different Site Manager');
      }
      if (proposal) {
        await this.validateProposalScope(manager, siteId, proposal);
      }
      if (kind === 'ACCEPT') {
        if (!row.current_result) conflict('Identification proposal is unavailable');
        await this.validateProposalScope(manager, siteId, row.current_result, conflict);
      }
      const status = proposal
        ? 'RESPONDED'
        : kind === 'ACCEPT'
          ? 'CLOSED'
          : kind === 'CANCEL'
            ? 'CANCELLED'
            : 'OPEN';
      const resultId = proposal ? commandId : status === 'OPEN' ? null : row.current_result_id;
      const [updated]: { updated_at: Date }[] = await manager.query(
        `WITH changed AS (
          UPDATE safety_identification_request SET status=$3,version=version+1,
            assigned_to=$4,current_result_id=$5,updated_at=GREATEST(updated_at,clock_timestamp())
          WHERE id=$1 AND site_id=$2 AND version=$6 RETURNING updated_at
        ) SELECT updated_at FROM changed`,
        [id, siteId, status, nextAssignee ?? row.assigned_to, resultId, row.version],
      );
      if (!updated) conflict('Identification request version changed');
      const result = response({
        ...row,
        status,
        version: row.version + 1,
        assigned_to: nextAssignee ?? row.assigned_to,
        updated_at: updated.updated_at,
        current_result: proposal
          ? {
              ...proposal,
              reason,
              respondedBy: actor.id,
              respondedAt: updated.updated_at.toISOString(),
            }
          : resultId
            ? row.current_result
            : null,
      });
      await manager.query(
        `INSERT INTO safety_identification_action(command_id,request_id,site_id,actor_user_id,request_version,kind,request_hash,payload,result)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [commandId, id, siteId, actor.id, result.version, kind, hash, payload, result],
      );
      return { request: result, replayed: false };
    });
  }

  private async validateProposalScope(
    manager: EntityManager,
    siteId: string,
    proposal: {
      workerId: string | null;
      contractorId: string | null;
    },
    reject = invalid,
  ) {
    if (proposal.workerId) {
      const [worker] = await manager.query(
        `SELECT id FROM worker WHERE id=$1 AND site_id=$2 AND is_active
         AND ($3::uuid IS NULL OR contractor_id=$3) FOR SHARE`,
        [proposal.workerId, siteId, proposal.contractorId],
      );
      if (!worker) reject('Worker is unavailable at this Site');
    }
    if (proposal.contractorId) {
      const [contractor] = await manager.query(
        `SELECT p.id FROM contractor_site_participation p JOIN contractor c ON c.id=p.contractor_id
         WHERE p.contractor_id=$1 AND p.site_id=$2 AND p.is_active AND c.is_active
         AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP)
         FOR SHARE OF p,c`,
        [proposal.contractorId, siteId],
      );
      if (!contractor) reject('Contractor is unavailable at this Site');
    }
  }

  async get(request: AuthenticatedRequest, siteValue: string, idValue: string) {
    const siteId = uuid(siteValue).toLowerCase();
    const id = uuid(idValue);
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, request, siteId);
      const [row]: RequestRow[] = await manager.query(
        requestSelect + ' WHERE r.site_id=$1 AND r.id=$2 AND ($3 OR r.assigned_to=$4)',
        [siteId, id, actor.officer, actor.id],
      );
      if (!row) missing();
      return response(row);
    });
  }

  async previewEvidence(request: AuthenticatedRequest, siteValue: string, body: unknown) {
    const siteId = uuid(siteValue).toLowerCase();
    const { bytes, sha256, frameSha256 } = await this.prepareEvidencePreview(
      request,
      siteId,
      parseEvidencePreviewInput(body),
    );
    return { bytes, sha256, frameSha256 };
  }

  private async prepareEvidencePreview(
    request: AuthenticatedRequest,
    siteId: string,
    { episodeId, masks, ...source }: ReturnType<typeof parseEvidencePreviewInput>,
  ) {
    const siteEpisodeId = episodeId.toLowerCase();
    const snapshot = await this.readPreviewScope(request, siteId, siteEpisodeId, source);
    const crop =
      snapshot.episode.subjectKind === 'EVENT_LOCAL'
        ? await this.cropEventLocalPreview(siteId, source, snapshot.episode)
        : await this.trackedFrames.read(request, siteId, siteEpisodeId, source, 'SUBJECT');
    const preview = await renderEvidencePreview(crop.bytes, masks);
    const current = await this.readPreviewScope(request, siteId, siteEpisodeId, source);
    if (current.actor !== snapshot.actor || !isDeepStrictEqual(current.episode, snapshot.episode))
      missing();
    return { ...preview, frameSha256: crop.frameSha256, scope: current };
  }

  private async readPreviewScope(
    request: AuthenticatedRequest,
    siteId: string,
    episodeId: string,
    source: { alertId: string; eventId: string; personObservationIndex: number },
    transaction?: EntityManager,
  ) {
    const read = async (manager: EntityManager) => {
      const actor = await this.actor(manager, request, siteId);
      if (!actor.officer) forbidden();
      const [episode] = await manager.query<
        {
          subjectKind: RequestRow['subject_kind'];
          cameraId: string;
          payloadHash: string;
          rawPayload: unknown;
        }[]
      >(
        `SELECT e.subject_kind AS "subjectKind", e.camera_id AS "cameraId",
           e.payload_hash AS "payloadHash",
           CASE WHEN e.subject_kind='EVENT_LOCAL' THEN raw.raw_payload END AS "rawPayload"
         FROM safety_episode e
         JOIN safety_alert a ON (a.episode_id,a.site_id)=(e.id,e.site_id)
         JOIN alert_detection_mapping m ON m.alert_id=a.id
         JOIN ai_observation_event raw ON raw.event_id=m.event_id
         WHERE e.site_id=$1 AND e.id=$2 AND a.id=$3
           AND m.event_id=$4 AND m.person_observation_index=$5
           AND (e.subject_kind='TRACKED' OR (
             e.event_id=m.event_id AND e.person_observation_index=m.person_observation_index
             AND raw.resolved_camera_id=e.camera_id AND raw.payload_hash=e.payload_hash
           ))`,
        [siteId, episodeId, source.alertId, source.eventId, source.personObservationIndex],
      );
      if (!episode) missing();
      return { actor: actor.id, episode };
    };
    return transaction ? read(transaction) : this.db.transaction(read);
  }

  private async cropEventLocalPreview(
    siteId: string,
    source: {
      alertId: string;
      eventId: string;
      personObservationIndex: number;
      evidenceIndex: number;
    },
    episode: { cameraId: string; payloadHash: string; rawPayload: unknown },
  ) {
    const frame = await this.alertEvidence.readFrameForIdentityReview(
      siteId,
      source.alertId,
      source.eventId,
      String(source.evidenceIndex),
      episode.payloadHash,
    );
    const raw = episode.rawPayload as {
      cameraExternalId: string;
      streamSessionId: string;
      capturedAt: string;
      frameDimensions?: { width: number; height: number };
      evidence?: { sha256?: string }[];
    };
    const selection = selectObservationSubject(raw, source.personObservationIndex);
    if (
      !selection.eligible ||
      !raw.frameDimensions ||
      raw.evidence?.[source.evidenceIndex]?.sha256 !== frame.sha256
    )
      missing();
    try {
      return await cropSafetySubjectFrame(
        { bytes: frame.bytes, sha256: frame.sha256, ...raw.frameDimensions },
        {
          eventId: source.eventId.toLowerCase(),
          personObservationIndex: source.personObservationIndex,
          payloadHash: episode.payloadHash,
          cameraId: episode.cameraId,
          cameraExternalId: raw.cameraExternalId,
          streamSessionId: raw.streamSessionId,
          capturedAt: raw.capturedAt,
          trackId: selection.trackId,
          personBoundingBox: selection.personBoundingBox,
        },
        { maxFrameBytes: 1_048_576, maxFramePixels: 16_000_000, maxCropBytes: 1_048_576 },
      );
    } catch {
      conflict('Identification evidence is unavailable');
    }
  }

  private async readEvidencePublication(
    request: AuthenticatedRequest,
    siteId: string,
    id: string,
    evidenceId: string,
  ) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, request, siteId);
      const [row] = await manager.query<
        {
          subjectKind: RequestRow['subject_kind'];
          eventId: string;
          personObservationIndex: number;
          evidence: unknown;
        }[]
      >(
        `SELECT e.subject_kind AS "subjectKind", e.event_id AS "eventId",
          e.person_observation_index AS "personObservationIndex",
          a.payload->'publishedEvidence' AS evidence
        FROM safety_identification_request r
        JOIN safety_episode e ON (e.id,e.site_id)=(r.episode_id,r.site_id)
        JOIN safety_identification_action a
          ON (a.request_id,a.site_id,a.actor_user_id)=(r.id,r.site_id,r.requested_by)
          AND a.request_version=1 AND a.kind='CREATE'
        WHERE r.site_id=$1 AND r.id=$2 AND ($3 OR r.assigned_to=$4)
          AND r.status <> 'CANCELLED'`,
        [siteId, id, actor.officer, actor.id],
      );
      const parsed = publishedEvidence.safeParse(row?.evidence);
      if (!row || !parsed.success) missing();
      const matching = parsed.data.filter(({ id }) => id === evidenceId);
      if (matching.length !== 1) missing();
      const [publication] = matching;
      if (!publication || Date.parse(publication.expiresAt) <= Date.now()) missing();
      if (row.subjectKind === 'EVENT_LOCAL') {
        if (
          publication.sourceEventId !== row.eventId ||
          publication.personObservationIndex !== row.personObservationIndex
        )
          missing();
      } else {
        const [linked] = await manager.query(
          `SELECT 1 FROM safety_identification_request r
           JOIN safety_alert a ON (a.episode_id,a.site_id)=(r.episode_id,r.site_id)
           JOIN alert_detection_mapping m ON m.alert_id=a.id
           WHERE r.site_id=$1 AND r.id=$2 AND m.event_id=$3 AND m.person_observation_index=$4 LIMIT 1`,
          [siteId, id, publication.sourceEventId, publication.personObservationIndex],
        );
        if (!linked) missing();
      }
      return publication;
    });
  }

  async evidence(
    request: AuthenticatedRequest,
    siteValue: string,
    idValue: string,
    evidenceValue: string,
  ) {
    const siteId = uuid(siteValue).toLowerCase();
    const id = uuid(idValue).toLowerCase();
    const evidenceId = uuid(evidenceValue).toLowerCase();
    const publication = await this.readEvidencePublication(request, siteId, id, evidenceId);
    const bytes = await this.storage.read(publication.object);
    const current = await this.readEvidencePublication(request, siteId, id, evidenceId);
    if (!isDeepStrictEqual(publication, current)) missing();
    if (bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9)
      missing();
    return { bytes, sha256: publication.object.sha256, expiresAt: publication.expiresAt };
  }

  async history(
    request: AuthenticatedRequest,
    siteValue: string,
    idValue: string,
    offset?: string,
    limit?: string,
  ): Promise<SafetyIdentificationHistoryPage> {
    const siteId = uuid(siteValue).toLowerCase();
    const id = uuid(idValue).toLowerCase();
    const page = pagination(offset, limit);
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const actor = await this.actor(manager, request, siteId);
      if (!actor.officer) forbidden();
      const [context] = await manager.query(
        'SELECT id FROM safety_identification_request WHERE site_id=$1 AND id=$2',
        [siteId, id],
      );
      if (!context) missing();
      const scope = ' FROM safety_identification_action WHERE site_id=$1 AND request_id=$2';
      const [count]: [{ total: number }] = await manager.query(
        'SELECT count(*)::int AS total' + scope,
        [siteId, id],
      );
      const rows: (Omit<SafetyIdentificationHistoryEntry, 'recordedAt'> & { recordedAt: Date })[] =
        await manager.query(
          `SELECT request_version AS version,kind,actor_user_id AS "actorId",
             payload->>'reason' AS reason,result->>'assignedTo' AS "assignedTo",
             CASE WHEN kind='RESPOND' THEN result->'result' END AS proposal,created_at AS "recordedAt"` +
            scope +
            ' ORDER BY request_version DESC OFFSET $3 LIMIT $4',
          [siteId, id, page.offset, page.limit],
        );
      return {
        items: rows.map((row) => ({ ...row, recordedAt: row.recordedAt.toISOString() })),
        total: count.total,
      };
    });
  }

  async list(
    request: AuthenticatedRequest,
    siteValue: string,
    offset?: string,
    limit?: string,
    status?: string,
  ) {
    const siteId = uuid(siteValue).toLowerCase();
    const page = pagination(offset, limit);
    if (status !== undefined && !SAFETY_IDENTIFICATION_STATUSES.some((value) => value === status))
      invalid('Invalid identification request status');
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const actor = await this.actor(manager, request, siteId);
      const params = [siteId, actor.officer, actor.id, status ?? null];
      const scope =
        ' WHERE r.site_id=$1 AND ($2 OR r.assigned_to=$3) AND ($4::text IS NULL OR r.status=$4)';
      const [{ total }] = await manager.query(
        'SELECT count(*)::int AS total FROM safety_identification_request r' + scope,
        params,
      );
      const rows: RequestRow[] = await manager.query(
        requestSelect + scope + ' ORDER BY r.created_at DESC,r.id DESC OFFSET $5 LIMIT $6',
        [...params, page.offset, page.limit],
      );
      return { items: rows.map(response), total: total as number };
    });
  }
}
