import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type {
  TrackedEpisodeObservationOptions,
  TrackedEpisodeObservationPage,
  TrackedEpisodeMediaSource,
  TrackedEpisodeMediaRepresentation,
} from '@smartsite/contracts/tracked-episode-frames';
import {
  computeCanonicalPayloadHash,
  computeWorkerEventBindingHash,
  parseWorkerEventDeliveryContext,
  validateTrackedObservationEvent,
  type ObservationFramePartition,
} from '@smartsite/contracts';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { uuid, invalid, missing, conflict } from '../../../common/configuration/commands.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import type { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { readHistoricalIssuedCameraBundleInTransaction } from '../../cameras/camera-configuration-bundle-reader.js';
import {
  ObservationContextResolverService,
  type ResolvedObservationContext,
} from '../../zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator, type Observation } from './alert-candidate-evaluator.js';
import {
  readMf06FrameMedia,
  readMf06SubjectMedia,
} from '../assessments/mf06-frame-media.reader.js';
import type { Mf06FrameReference } from '../assessments/mf06-frame-reference.js';
import { projectObservationSubjectRef } from '../identity/observation-identity-subject-ref.js';
import { parseNormalizedCapturedAt } from '../../../common/parse-normalized-captured-at.js';

interface Scope {
  id: string;
  siteId: string;
  cameraId: string;
  segmentId: string;
  scopeSha256: string;
  contentRevision: number;
}
interface Mapping {
  alertId: string;
  eventId: string;
  personIndex: number;
  subtype: string;
  zoneId: string | null;
  payloadHash: string;
  rawPayload: unknown;
  cameraId: string | null;
  sessionId: string;
  capturedAt: Date;
  partIndex: number;
  partCount: number;
  frameId: string;
  sequence: string;
  state: string;
  scopeSha256: string;
  generationId: string;
  routeMode: string | null;
  routeEpoch: string | null;
  admission: { context: unknown; classification: string; bindingHash: string } | null;
}
interface Payload {
  eventId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  frameDimensions: { width: number; height: number };
  framePartition: ObservationFramePartition;
  observations: Observation[];
  evidence: Array<{ kind: string; uri: string; sha256: string }>;
  continuity: { subjects: Array<{ personObservationIndex: number; segmentId: string }> };
}
type Source = TrackedEpisodeMediaSource;
const sequence = (value: string) =>
  typeof value === 'string' &&
  /^(0|[1-9][0-9]{0,19})$/.test(value) &&
  BigInt(value) <= 18446744073709551615n;
function denied(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}
const mappingColumns = `a.id AS "alertId",a.candidate_subtype AS subtype,a.zone_id AS "zoneId",m.event_id AS "eventId",m.person_observation_index AS "personIndex",
  r.payload_hash AS "payloadHash",r.raw_payload AS "rawPayload",r.resolved_camera_id AS "cameraId",r.stream_session_id AS "sessionId",r.captured_at AS "capturedAt",
  r.tracking_part_index AS "partIndex",r.tracking_part_count AS "partCount",r.tracking_frame_id AS "frameId",r.tracking_source_sequence::text AS sequence,
  r.tracking_frame_state AS state,r.tracking_scope_sha256 AS "scopeSha256",r.tracking_generation_id AS "generationId",
  r.safety_route_mode AS "routeMode",r.safety_route_epoch AS "routeEpoch",r.admission_context AS admission`;

/** Unregistered domain reader, not a public DTO/controller or MF08 reader replacement.
 * Original FRAME media can also produce a mechanical PERSON crop; neither identifies a Worker.
 */
export class TrackedEpisodeFrameQuery {
  constructor(
    private readonly db: DataSource,
    private readonly auth: UserAuthGuard,
    private readonly root: string,
    private readonly frameReader: typeof readMf06FrameMedia = readMf06FrameMedia,
    private readonly subjectReader: typeof readMf06SubjectMedia = readMf06SubjectMedia,
  ) {}

  private async authorize(manager: EntityManager, request: AuthenticatedRequest, siteId: string) {
    await this.auth.authenticateRequest(request, manager);
    if (!request.user)
      throw new PublicHttpException(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
    if (request.user.mustChangePassword)
      throw new PublicHttpException(403, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    const roles = await manager.query<Array<{ role: string; site_id: string | null }>>(
      'SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 ORDER BY id FOR SHARE',
      [request.user.id],
    );
    if (
      !roles.some(
        (r) =>
          (r.role === 'ADMIN' && r.site_id === null) ||
          (r.role === 'SAFETY_OFFICER' && r.site_id === siteId),
      )
    )
      denied();
    return { userId: request.user.id, sessionId: request.sessionId };
  }
  private async episode(manager: EntityManager, siteId: string, id: string): Promise<Scope> {
    const [e] = await manager.query<Scope[]>(
      `SELECT id,site_id AS "siteId",camera_id AS "cameraId",tracking_segment_id AS "segmentId",
      tracking_scope_sha256 AS "scopeSha256",content_revision AS "contentRevision" FROM safety_episode
      WHERE id=$1 AND site_id=$2 AND subject_kind='TRACKED' FOR SHARE`,
      [id, siteId],
    );
    if (!e) missing();
    return e;
  }
  private async qualify(manager: EntityManager, e: Scope, row: Mapping) {
    if (
      !validateTrackedObservationEvent(row.rawPayload).isValid ||
      computeCanonicalPayloadHash(row.rawPayload) !== row.payloadHash ||
      row.cameraId !== e.cameraId ||
      row.scopeSha256 !== e.scopeSha256 ||
      row.routeMode !== 'EPISODE_TRACKED' ||
      !row.routeEpoch ||
      !Number.isSafeInteger(row.personIndex) ||
      row.personIndex < 0 ||
      !sequence(row.sequence) ||
      row.admission?.classification !== 'LIVE'
    )
      conflict('Tracked evidence provenance is inconsistent');
    const raw = row.rawPayload as Payload,
      ctx = parseWorkerEventDeliveryContext(row.admission.context);
    const captured = parseNormalizedCapturedAt(raw.capturedAt);
    if (
      !ctx ||
      ctx.cameraId !== e.cameraId ||
      ctx.workerGenerationId !== row.generationId ||
      ctx.streamSessionId !== row.sessionId ||
      raw.eventId.toLowerCase() !== row.eventId ||
      raw.streamSessionId.toLowerCase() !== row.sessionId ||
      raw.framePartition.frameId !== row.frameId ||
      raw.framePartition.sequenceNumber !== row.sequence ||
      raw.framePartition.partIndex !== row.partIndex ||
      raw.framePartition.partCount !== row.partCount ||
      !captured ||
      captured.getTime() !== row.capturedAt.getTime() ||
      computeWorkerEventBindingHash(row.payloadHash, ctx) !== row.admission.bindingHash
    )
      conflict('Tracked evidence binding is inconsistent');
    const [coordinator] = await manager.query<Array<{ epoch: string }>>(
      `SELECT c.safety_route_epoch AS epoch FROM ai_observation_event c
      WHERE c.resolved_camera_id=$1 AND c.tracking_generation_id=$2 AND c.stream_session_id=$3 AND c.tracking_frame_id=$4
      AND c.tracking_scope_sha256=$5 AND c.tracking_site_id=$6 AND c.tracking_source_sequence=$7 AND c.tracking_part_count=$8
      AND c.tracking_part_index=0 AND c.tracking_frame_state='SEALED' AND c.safety_route_mode='EPISODE_TRACKED'`,
      [
        e.cameraId,
        row.generationId,
        row.sessionId,
        row.frameId,
        e.scopeSha256,
        e.siteId,
        row.sequence,
        row.partCount,
      ],
    );
    if (
      !coordinator ||
      coordinator.epoch !== row.routeEpoch ||
      (row.partIndex === 0 ? row.state !== 'SEALED' : row.state !== 'PART_STAGED')
    )
      conflict('Tracked evidence frame is not admitted');
    const person = raw.observations[row.personIndex];
    const claims = raw.continuity.subjects.filter(
      (s) => s.personObservationIndex === row.personIndex,
    );
    if (
      !person ||
      person.type !== 'PERSON' ||
      claims.length !== 1 ||
      claims[0]!.segmentId !== e.segmentId
    )
      conflict('Tracked evidence subject is inconsistent');
    const [cross] = await manager.query<Array<{ bad: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM alert_detection_mapping m JOIN safety_alert a ON a.id=m.alert_id
      WHERE m.event_id=$1 AND a.site_id<>$2) AS bad`,
      [row.eventId, e.siteId],
    );
    if (cross?.bad) conflict('Tracked evidence Site is inconsistent');
    const bundle = await readHistoricalIssuedCameraBundleInTransaction(manager, {
      ...ctx,
      siteId: e.siteId,
      cameraExternalId: raw.cameraExternalId,
    });
    if (!bundle) conflict('Tracked evidence configuration is unavailable');
    const contexts = new Map<string, ResolvedObservationContext>(),
      resolver = new ObservationContextResolverService();
    for (const o of raw.observations) {
      if (o.type !== 'PPE' || o.trackId !== person.trackId) continue;
      const key = `${o.regionId}:${o.geometryVersion}`;
      if (!contexts.has(key)) {
        const context = await resolver.resolveIssuedRegion(
          manager,
          e.siteId,
          bundle,
          o.regionId,
          o.geometryVersion,
        );
        if (!context) conflict('Tracked evidence region is unavailable');
        contexts.set(key, context);
      }
    }
    const candidate = new AlertCandidateEvaluator()
      .evaluate(
        {
          streamSessionId: raw.streamSessionId,
          cameraExternalId: raw.cameraExternalId,
          observations: raw.observations.filter((o) => o.type !== 'ZONE_ENTRY'),
        },
        contexts,
      )
      .find(
        (c) =>
          c.trackId === person.trackId &&
          c.candidateSubtype === row.subtype &&
          (c.zoneId ?? null) === row.zoneId,
      );
    if (!candidate) conflict('Tracked evidence finding does not match the original observation');
    const observationIndexes = raw.observations.flatMap((o, i) =>
      o.type === 'PPE' &&
      o.trackId === person.trackId &&
      o.status === 'MISSING' &&
      o.ppeItem === candidate.details.ppeItem &&
      contexts.get(`${o.regionId}:${o.geometryVersion}`)?.zoneId === row.zoneId
        ? [i]
        : [],
    );
    const frames = raw.evidence.flatMap((item, i) =>
      item.kind === 'FRAME' ? [{ evidenceIndex: i, sha256: item.sha256 }] : [],
    );
    return {
      raw,
      frames,
      person,
      item: {
        alertId: row.alertId,
        eventId: row.eventId,
        personObservationIndex: row.personIndex,
        payloadHash: row.payloadHash,
        sourceSequence: row.sequence,
        capturedAt: raw.capturedAt,
        observationIndexes,
        frames,
      },
    };
  }
  async pageObservations(
    request: AuthenticatedRequest,
    rawSite: string,
    rawEpisode: string,
    options: TrackedEpisodeObservationOptions = {},
  ): Promise<TrackedEpisodeObservationPage> {
    const site = uuid(rawSite).toLowerCase(),
      id = uuid(rawEpisode).toLowerCase(),
      offset = options.offset ?? 0,
      limit = options.limit ?? 20;
    if (
      Object.keys(options).some(
        (k) => !['offset', 'limit', 'throughSequence', 'alertId'].includes(k),
      ) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      (options.throughSequence !== undefined && !sequence(options.throughSequence))
    )
      invalid();
    const alert = options.alertId === undefined ? null : uuid(options.alertId).toLowerCase(),
      requested = options.throughSequence;
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.authorize(manager, request, site);
      const e = await this.episode(manager, site, id);
      if (alert) {
        const allowed = await manager.query(
          'SELECT 1 FROM safety_alert WHERE id=$1 AND episode_id=$2 AND site_id=$3',
          [alert, id, site],
        );
        if (!allowed.length) missing();
      }
      const joined =
        'FROM safety_alert a JOIN alert_detection_mapping m ON m.alert_id=a.id JOIN ai_observation_event r ON r.event_id=m.event_id';
      const eligible = 'a.episode_id=$1 AND a.site_id=$2 AND ($3::uuid IS NULL OR a.id=$3)';
      const [last] = await manager.query<Array<{ value: string | null }>>(
        `SELECT max(r.tracking_source_sequence)::text AS value ${joined} WHERE ${eligible}`,
        [id, site, alert],
      );
      if (!last?.value || !sequence(last.value))
        conflict('Tracked observation history is unavailable');
      const through = requested ?? last.value;
      if (BigInt(through) > BigInt(last.value)) invalid();
      const params = [id, site, alert, through];
      const [count] = await manager.query<Array<{ total: number }>>(
        `SELECT count(*)::int AS total ${joined} WHERE ${eligible} AND r.tracking_source_sequence<=$4::numeric`,
        params,
      );
      const rows = await manager.query<Mapping[]>(
        `SELECT ${mappingColumns} ${joined} WHERE ${eligible} AND r.tracking_source_sequence<=$4::numeric
        ORDER BY r.tracking_source_sequence DESC,r.tracking_part_index,r.event_id,a.id OFFSET $5 LIMIT $6`,
        [...params, offset, limit],
      );
      const items = [];
      for (const row of rows) items.push((await this.qualify(manager, e, row)).item);
      return {
        episodeId: id,
        contentRevision: e.contentRevision,
        throughSequence: through,
        offset,
        limit,
        total: count?.total ?? 0,
        hasMore: offset + items.length < (count?.total ?? 0),
        items,
      };
    });
  }
  private async load(
    manager: EntityManager,
    request: AuthenticatedRequest,
    site: string,
    id: string,
    source: Source,
  ) {
    const actor = await this.authorize(manager, request, site),
      e = await this.episode(manager, site, id);
    const [row] = await manager.query<Mapping[]>(
      `SELECT ${mappingColumns} FROM safety_alert a JOIN alert_detection_mapping m ON m.alert_id=a.id
      JOIN ai_observation_event r ON r.event_id=m.event_id WHERE a.id=$1 AND a.episode_id=$2 AND a.site_id=$3 AND m.event_id=$4`,
      [source.alertId, id, site, source.eventId],
    );
    if (!row || row.personIndex !== source.personObservationIndex) missing();
    const selected = await this.qualify(manager, e, row);
    const descriptor = selected.frames.find((f) => f.evidenceIndex === source.evidenceIndex);
    if (!descriptor) missing();
    const item = selected.raw.evidence[source.evidenceIndex]!;
    const reference: Mf06FrameReference = {
      eventId: row.eventId,
      streamSessionId: row.sessionId,
      payloadHash: row.payloadHash,
      sequenceNumber: row.sequence,
      framePartition: { ...selected.raw.framePartition },
      frameDimensions: { ...selected.raw.frameDimensions },
      uri: item.uri,
      sha256: item.sha256,
    };
    const subject = projectObservationSubjectRef({
      eventId: row.eventId,
      personObservationIndex: row.personIndex,
      payloadHash: row.payloadHash,
      cameraId: e.cameraId,
      cameraExternalId: selected.raw.cameraExternalId,
      streamSessionId: row.sessionId,
      capturedAt: selected.raw.capturedAt,
      trackId: selected.person.trackId,
      personBoundingBox: 'boundingBox' in selected.person ? selected.person.boundingBox : undefined,
    });
    return { actor, reference, subject };
  }
  async read(
    request: AuthenticatedRequest,
    rawSite: string,
    rawEpisode: string,
    input: Source,
    representation: TrackedEpisodeMediaRepresentation = 'FRAME',
    signal?: AbortSignal,
  ) {
    const site = uuid(rawSite).toLowerCase(),
      id = uuid(rawEpisode).toLowerCase();
    if (
      !input ||
      Object.keys(input).sort().join(',') !==
        'alertId,eventId,evidenceIndex,personObservationIndex' ||
      !Number.isSafeInteger(input.personObservationIndex) ||
      input.personObservationIndex < 0 ||
      input.personObservationIndex > 255 ||
      !Number.isSafeInteger(input.evidenceIndex) ||
      input.evidenceIndex < 0 ||
      input.evidenceIndex > 255 ||
      !['FRAME', 'SUBJECT'].includes(representation)
    )
      invalid();
    const source = {
      ...input,
      alertId: uuid(input.alertId).toLowerCase(),
      eventId: uuid(input.eventId).toLowerCase(),
    };
    const snapshot = await this.db.transaction('REPEATABLE READ', (m) =>
      this.load(m, request, site, id, source),
    );
    let media: { bytes: Buffer; sha256: string; frameSha256: string } | null = null;
    try {
      if (representation === 'FRAME') {
        const frame = await this.frameReader(this.root, snapshot.reference, signal);
        if (frame) media = { bytes: frame.bytes, sha256: frame.sha256, frameSha256: frame.sha256 };
      } else if (snapshot.subject) {
        const crop = await this.subjectReader(
          this.root,
          snapshot.reference,
          snapshot.subject,
          signal,
        );
        if (crop)
          media = { bytes: crop.bytes, sha256: crop.cropSha256, frameSha256: crop.frameSha256 };
      }
    } catch {
      media = null;
    }
    signal?.throwIfAborted();
    const current = await this.db.transaction((m) => this.load(m, request, site, id, source));
    if (
      current.actor.userId !== snapshot.actor.userId ||
      current.actor.sessionId !== snapshot.actor.sessionId
    )
      denied();
    if (
      current.reference.payloadHash !== snapshot.reference.payloadHash ||
      current.reference.sha256 !== snapshot.reference.sha256
    )
      conflict('Tracked evidence changed');
    if (
      !media ||
      media.bytes.length > 1048576 ||
      media.frameSha256 !== snapshot.reference.sha256 ||
      createHash('sha256').update(media.bytes).digest('hex') !== media.sha256
    )
      conflict('Tracked evidence is unavailable or inconsistent');
    return {
      ...media,
      representation,
      fileName: `${source.eventId}-${source.personObservationIndex}-${representation.toLowerCase()}.jpg`,
    };
  }
}
