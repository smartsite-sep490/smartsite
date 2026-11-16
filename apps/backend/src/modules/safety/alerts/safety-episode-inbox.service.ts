import { HttpStatus, Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID, IsString, Length } from 'class-validator';
import { DataSource, type EntityManager } from 'typeorm';
import { parseSafetyEpisodeReadCommand } from '@smartsite/contracts/safety-episodes';
import type { SafetyEpisodeInboxPage, SafetyEpisodeReadResponse } from '@smartsite/contracts';
import type {
  SafetyEpisodeInboxSummary,
  SafetyFrameInboxPage,
} from '@smartsite/contracts/safety-episodes';
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

class ExactFrameInboxFilter {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsUUID() cameraId?: string;
  @IsOptional() @IsIn(['ALL', 'UNREAD']) readStatus?: 'ALL' | 'UNREAD';
  @IsOptional() @IsString() @Length(1, 200) frameKey?: string;
}

class InboxFilter {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsUUID() recipientId?: string;
  @IsOptional() @IsIn(['ALL', 'UNREAD']) readStatus?: 'ALL' | 'UNREAD';
}
interface InboxRow {
  id: string;
  episode_id: string;
  site_id: string;
  camera_id: string;
  event_id: string;
  person_observation_index: number;
  content_revision: number;
  seen_revision: number;
  collection_state: 'COLLECTING' | 'SEALED';
  finding_count: number;
  first_observed_at: Date;
  last_observed_at: Date;
  first_delivered_at: Date;
  updated_at: Date;
  subject_metadata: { kind: unknown; segmentId: unknown; scopeSha256: unknown };
}

function inboxSubject(row: InboxRow): SafetyEpisodeInboxSummary['subject'] {
  const subject = row.subject_metadata;
  if (subject.kind === 'EVENT_LOCAL' && subject.segmentId === null && subject.scopeSha256 === null)
    return {
      kind: 'EVENT_LOCAL',
      eventId: row.event_id,
      personObservationIndex: row.person_observation_index,
    };
  if (
    subject.kind === 'TRACKED' &&
    typeof subject.segmentId === 'string' &&
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(subject.segmentId) &&
    typeof subject.scopeSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(subject.scopeSha256)
  )
    return { kind: 'TRACKED', segmentId: subject.segmentId, scopeSha256: subject.scopeSha256 };
  conflict('Episode inbox subject is inconsistent');
}

@Injectable()
export class SafetyEpisodeInboxService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: UserAuthGuard,
    private readonly trackedEvidenceEnabled: () => boolean = () => false,
  ) {}

  private schema(): string {
    const schema = this.db.driver.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema) > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      throw new Error('SAFETY_EPISODE_SCHEMA_UNAVAILABLE');
    return '"' + schema.replaceAll('"', '""') + '"';
  }

  private async scope(manager: EntityManager, request: AuthenticatedRequest) {
    // Hold current account/session locks until the query/read transaction commits.
    await this.auth.authenticateRequest(request, manager);
    if (!request.user) this.forbidden();
    if (request.user.mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    const userId = request.user.id;
    const schema = this.schema();
    const roles: { site_id: string }[] = await manager.query(
      `SELECT site_id FROM ${schema}.user_role_assignment
      WHERE user_id=$1 AND role='SAFETY_OFFICER' AND site_id IS NOT NULL ORDER BY site_id,id FOR SHARE`,
      [userId],
    );
    if (!roles.length) this.forbidden();
    return { userId, siteIds: roles.map((role) => role.site_id) };
  }

  private forbidden(): never {
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
  }

  async list(
    request: AuthenticatedRequest,
    query: Record<string, unknown> = {},
  ): Promise<SafetyEpisodeInboxPage> {
    const { offset, limit, ...filter } = query;
    for (const key of ['siteId', 'recipientId', 'readStatus'] as const)
      if (query[key] !== undefined && typeof query[key] !== 'string') invalid();
    if (
      (offset !== undefined && typeof offset !== 'string') ||
      (limit !== undefined && typeof limit !== 'string')
    )
      invalid();
    const options = command(InboxFilter, filter),
      page = pagination(offset, limit);
    const siteId = options.siteId?.toLowerCase() ?? null,
      unreadOnly = options.readStatus === 'UNREAD';
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const actor = await this.scope(manager, request),
        schema = this.schema();
      if (siteId !== null && !actor.siteIds.includes(siteId)) this.forbidden();
      const params = [actor.userId, actor.siteIds, siteId, unreadOnly, options.recipientId ?? null];
      const eligible = `r.recipient_user_id=$1 AND r.site_id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR r.site_id=$3)
        AND ($5::uuid IS NULL OR r.id=$5)
        AND EXISTS(SELECT 1 FROM ${schema}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id)`;
      const [counts]: { total: number; unread_count: number }[] = await manager.query(
        `SELECT
        count(*) FILTER(WHERE NOT $4::boolean OR r.seen_revision<e.content_revision)::int AS total,
        count(*) FILTER(WHERE r.seen_revision<e.content_revision)::int AS unread_count
        FROM ${schema}.safety_episode_recipient r JOIN ${schema}.safety_episode e ON e.id=r.episode_id AND e.site_id=r.site_id
        WHERE ${eligible}`,
        params,
      );
      const rows: InboxRow[] = await manager.query(
        `SELECT r.id,r.episode_id,r.seen_revision,r.first_delivered_at,r.updated_at,
        e.site_id,e.camera_id,e.event_id,e.person_observation_index,e.first_observed_at,e.last_observed_at,
        e.content_revision,e.collection_state,(SELECT count(*)::int FROM ${schema}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id) AS finding_count,
        jsonb_build_object('kind',CASE WHEN to_jsonb(e) ? 'subject_kind' THEN to_jsonb(e)->>'subject_kind' ELSE 'EVENT_LOCAL' END,
          'segmentId',to_jsonb(e)->>'tracking_segment_id','scopeSha256',to_jsonb(e)->>'tracking_scope_sha256') AS subject_metadata
        FROM ${schema}.safety_episode_recipient r JOIN ${schema}.safety_episode e ON e.id=r.episode_id AND e.site_id=r.site_id
        WHERE ${eligible} AND (NOT $4::boolean OR r.seen_revision<e.content_revision)
        ORDER BY r.first_delivered_at DESC,r.id DESC OFFSET $6 LIMIT $7`,
        [...params, page.offset, page.limit],
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          episode: {
            id: row.episode_id,
            siteId: row.site_id,
            cameraId: row.camera_id,
            subject: inboxSubject(row),
            configurationBundleId: null,
            firstObservedAt: row.first_observed_at.toISOString(),
            lastObservedAt: row.last_observed_at.toISOString(),
            contentRevision: row.content_revision,
            collectionState: row.collection_state,
            findingCount: row.finding_count,
          },
          seenRevision: row.seen_revision,
          unread: row.seen_revision < row.content_revision,
          firstDeliveredAt: row.first_delivered_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
        total: counts?.total ?? 0,
        unreadCount: counts?.unread_count ?? 0,
      };
    });
  }

  async listFrames(
    request: AuthenticatedRequest,
    query: Record<string, unknown> = {},
  ): Promise<SafetyFrameInboxPage> {
    const { offset, limit, ...filter } = query;
    for (const key of ['siteId', 'cameraId', 'frameKey', 'readStatus'] as const)
      if (query[key] !== undefined && typeof query[key] !== 'string') invalid();
    if (
      (offset !== undefined && typeof offset !== 'string') ||
      (limit !== undefined && typeof limit !== 'string')
    )
      invalid();
    const options = command(ExactFrameInboxFilter, filter);
    const page = pagination(offset, limit);
    const siteId = options.siteId?.toLowerCase() ?? null;
    const cameraId = options.cameraId?.toLowerCase() ?? null;

    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const actor = await this.scope(manager, request);
      const schema = this.schema();
      if (siteId !== null && !actor.siteIds.includes(siteId)) this.forbidden();
      // Episode anchors identify where a case first arose. Tracked partitions share
      // the frame ID within a generation scope. Older events retain their event ID.
      const [result]: SafetyFrameInboxPage[] = await manager.query(
        `WITH recipient_cases AS (
          SELECT r.id AS recipient_id, e.id AS episode_id, e.site_id, e.camera_id,
            CASE WHEN to_jsonb(o)->>'tracking_scope_sha256' IS NOT NULL
                       AND to_jsonb(o)->>'tracking_frame_id' IS NOT NULL
                 THEN 'tracked:' || (to_jsonb(o)->>'tracking_scope_sha256') || ':' || (to_jsonb(o)->>'tracking_frame_id')
                 ELSE 'event:' || e.event_id::text END AS frame_key,
            e.person_observation_index AS person_index, e.first_observed_at AS captured_at, e.content_revision,
            GREATEST(r.first_delivered_at, (SELECT max(a.created_at) FROM ${schema}.safety_alert a
              WHERE a.episode_id=e.id AND a.site_id=e.site_id)) AS latest_delivery_at,
            r.seen_revision < e.content_revision AS unread,
            (SELECT count(*)::int FROM ${schema}.safety_alert a
             WHERE a.episode_id=e.id AND a.site_id=e.site_id AND a.alert_type='PPE_VIOLATION') AS finding_count,
            EXISTS(SELECT 1 FROM ${schema}.safety_alert a
             WHERE a.episode_id=e.id AND a.site_id=e.site_id
               AND a.alert_type='RESTRICTED_ZONE_INTRUSION') AS has_zone_finding,
            (SELECT jsonb_build_object('alertId', a.id, 'eventId', e.event_id,
              'personObservationIndex', e.person_observation_index,
              'evidenceIndex', media.ordinality - 1, 'sha256', media.value->>'sha256')
             FROM ${schema}.safety_alert a
             JOIN ${schema}.alert_detection_mapping m ON m.alert_id=a.id
             CROSS JOIN LATERAL jsonb_array_elements(o.raw_payload->'evidence') WITH ORDINALITY media
             WHERE a.episode_id=e.id AND a.site_id=e.site_id AND m.event_id=e.event_id
               AND m.person_observation_index=e.person_observation_index
               AND to_jsonb(e)->>'subject_kind'='TRACKED'
               AND $8::boolean
               AND media.value->>'kind'='FRAME'
             ORDER BY a.id, media.ordinality LIMIT 1) AS source,
            coalesce((SELECT jsonb_agg(jsonb_build_object(
              'requestId', q.request_id, 'zoneId', q.zone_id,
              'status', CASE WHEN a.provenance='SYNTHETIC_TEST' THEN 'UNAVAILABLE'
                ELSE coalesce(a.outcome, 'PENDING') END,
              'reasonCode', CASE WHEN a.provenance='SYNTHETIC_TEST' THEN 'AUTHORITY_UNAVAILABLE'
                ELSE a.reason_code END,
              'provenance', CASE WHEN a.provenance='SYNTHETIC_TEST' THEN 'UNAVAILABLE'
                ELSE a.provenance END,
              'laterFrame', q.event_id<>e.event_id AND NOT coalesce(
                to_jsonb(qo)->>'tracking_frame_id'=to_jsonb(o)->>'tracking_frame_id'
                AND to_jsonb(qo)->>'tracking_scope_sha256'=to_jsonb(o)->>'tracking_scope_sha256', false)
            ) ORDER BY q.captured_at, q.zone_observation_index, q.request_id)
            FROM ${schema}.zone_entry_assessment_request q
            JOIN ${schema}.ai_observation_event qo ON qo.event_id=q.event_id
              AND qo.resolved_camera_id=q.camera_id AND qo.payload_hash=q.payload_hash
            LEFT JOIN ${schema}.zone_entry_assessment a
              ON a.request_id=q.request_id AND a.site_id=q.site_id
                AND a.event_id=q.event_id AND a.binding_hash=q.binding_hash
            WHERE q.site_id=e.site_id AND q.camera_id=e.camera_id
              AND ((q.event_id=e.event_id AND q.person_observation_index=e.person_observation_index)
                OR (a.outcome='DENIED' AND a.provenance='TRUSTED_SERVICE' AND EXISTS(
                  SELECT 1 FROM ${schema}.safety_alert z
                  JOIN ${schema}.alert_detection_mapping m ON m.alert_id=z.id
                  WHERE z.episode_id=e.id AND z.site_id=e.site_id AND z.zone_id=q.zone_id
                    AND z.alert_type='RESTRICTED_ZONE_INTRUSION'
                    AND z.candidate_subtype=CASE a.reason_code
                      WHEN 'POLICY_PROHIBITED' THEN 'ZONE_ENTRY_PROHIBITED'
                      WHEN 'UNAUTHORIZED' THEN 'ZONE_ENTRY_UNAUTHORIZED' END
                    AND m.event_id=q.event_id AND m.person_observation_index=q.person_observation_index)))
              AND q.requested_purpose='INITIAL_OBSERVATION_ASSESSMENT'),
            '[]'::jsonb) AS zone_entries
          FROM ${schema}.safety_episode_recipient r
          JOIN ${schema}.safety_episode e ON e.id=r.episode_id AND e.site_id=r.site_id
          LEFT JOIN ${schema}.ai_observation_event o
            ON o.event_id=e.event_id AND o.resolved_camera_id=e.camera_id
          WHERE r.recipient_user_id=$1 AND r.site_id=ANY($2::uuid[])
            AND ($3::uuid IS NULL OR r.site_id=$3)
            AND ($9::uuid IS NULL OR e.camera_id=$9)
        ), frames AS (
          SELECT site_id, camera_id, frame_key, min(captured_at) AS captured_at,
            max(latest_delivery_at) AS delivered_at, bool_or(unread) AS unread,
            sum(finding_count)::int AS finding_count,
            jsonb_agg(jsonb_build_object('recipientId', recipient_id, 'episodeId', episode_id,
              'findingCount', finding_count, 'unread', unread, 'contentRevision', content_revision, 'zoneEntries', zone_entries, 'source', source)
              ORDER BY person_index, recipient_id) AS cases
          FROM recipient_cases WHERE finding_count > 0 OR has_zone_finding
          GROUP BY site_id, camera_id, frame_key
          HAVING $7::text IS NULL OR frame_key=$7
        ), visible AS (
          SELECT * FROM frames WHERE NOT $4::boolean OR unread
          ORDER BY delivered_at DESC, site_id, camera_id, frame_key OFFSET $5 LIMIT $6
        )
        SELECT
          (SELECT count(*)::int FROM frames WHERE NOT $4::boolean OR unread) AS total,
          (SELECT count(*)::int FROM frames WHERE unread) AS "unreadCount",
          coalesce((SELECT jsonb_agg(jsonb_build_object(
            'siteId', site_id, 'cameraId', camera_id, 'frameKey', frame_key,
            'siteName', (SELECT name FROM ${schema}.site WHERE id=visible.site_id),
            'cameraName', (SELECT name FROM ${schema}.camera WHERE id=visible.camera_id),
            'capturedAt', captured_at, 'unread', unread, 'findingCount', finding_count,
            'cases', cases) ORDER BY delivered_at DESC, site_id, camera_id, frame_key)
          FROM visible), '[]'::jsonb) AS items`,
        [
          actor.userId,
          actor.siteIds,
          siteId,
          options.readStatus === 'UNREAD',
          page.offset,
          page.limit,
          options.frameKey ?? null,
          this.trackedEvidenceEnabled(),
          cameraId,
        ],
      );
      if (!result) throw new Error('SAFETY_FRAME_INBOX_UNAVAILABLE');
      return result;
    });
  }

  async read(
    request: AuthenticatedRequest,
    id: string,
    input: unknown,
  ): Promise<SafetyEpisodeReadResponse> {
    id = uuid(id).toLowerCase();
    const body = parseSafetyEpisodeReadCommand(input);
    if (!body) invalid('Expected a positive safe integer seenRevision and no other fields');
    const seenRevision = body.seenRevision;
    return this.db.transaction(async (manager) => {
      const actor = await this.scope(manager, request),
        schema = this.schema();
      // Episode first: material revisions and acknowledgement serialize on the same row.
      const [episode]: { id: string; content_revision: number }[] = await manager.query(
        `SELECT e.id,e.content_revision
        FROM ${schema}.safety_episode_recipient r JOIN ${schema}.safety_episode e ON e.id=r.episode_id AND e.site_id=r.site_id
        WHERE r.id=$1 AND r.recipient_user_id=$2 AND r.site_id=ANY($3::uuid[])
          AND EXISTS(SELECT 1 FROM ${schema}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id)
        FOR UPDATE OF e`,
        [id, actor.userId, actor.siteIds],
      );
      if (!episode) missing();
      if (seenRevision > episode.content_revision)
        conflict('Seen revision exceeds the current episode revision');
      const [updated]: { seen_revision: number }[] = await manager.query(
        `WITH updated AS (
        UPDATE ${schema}.safety_episode_recipient SET seen_revision=GREATEST(seen_revision,$2),
          updated_at=CASE WHEN seen_revision<$2 THEN clock_timestamp() ELSE updated_at END
        WHERE id=$1 AND recipient_user_id=$3 RETURNING seen_revision)
        SELECT seen_revision FROM updated`,
        [id, seenRevision, actor.userId],
      );
      if (!updated) missing();
      return {
        id,
        contentRevision: episode.content_revision,
        seenRevision: updated.seen_revision,
        unread: updated.seen_revision < episode.content_revision,
      };
    });
  }
}
