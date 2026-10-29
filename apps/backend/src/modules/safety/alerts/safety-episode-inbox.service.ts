import { HttpStatus, Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { DataSource, type EntityManager } from 'typeorm';
import { parseSafetyEpisodeReadCommand } from '@smartsite/contracts/safety-episodes';
import type { SafetyEpisodeInboxPage, SafetyEpisodeReadResponse } from '@smartsite/contracts';
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

class InboxFilter {
  @IsOptional() @IsUUID() siteId?: string;
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
}

@Injectable()
export class SafetyEpisodeInboxService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: UserAuthGuard,
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
    for (const key of ['siteId', 'readStatus'] as const)
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
      const params = [actor.userId, actor.siteIds, siteId, unreadOnly];
      const eligible = `r.recipient_user_id=$1 AND r.site_id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR r.site_id=$3)
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
        e.content_revision,e.collection_state,(SELECT count(*)::int FROM ${schema}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id) AS finding_count
        FROM ${schema}.safety_episode_recipient r JOIN ${schema}.safety_episode e ON e.id=r.episode_id AND e.site_id=r.site_id
        WHERE ${eligible} AND (NOT $4::boolean OR r.seen_revision<e.content_revision)
        ORDER BY r.first_delivered_at DESC,r.id DESC OFFSET $5 LIMIT $6`,
        [...params, page.offset, page.limit],
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          episode: {
            id: row.episode_id,
            siteId: row.site_id,
            cameraId: row.camera_id,
            subject: {
              kind: 'EVENT_LOCAL' as const,
              eventId: row.event_id,
              personObservationIndex: row.person_observation_index,
            },
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
