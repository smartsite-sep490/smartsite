import { HttpStatus, Injectable } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import type { SafetyEpisodePage } from '@smartsite/contracts';
import { command, invalid, uuid } from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';

class EpisodeFilters {
  @IsOptional() @IsUUID() cameraId?: string;
  @IsOptional() @IsUUID() zoneId?: string;
}

@Injectable()
export class SafetyEpisodeQueryService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: UserAuthGuard,
  ) {}

  async list(
    request: AuthenticatedRequest,
    rawSiteId: string,
    query: Record<string, unknown>,
  ): Promise<SafetyEpisodePage> {
    const siteId = uuid(rawSiteId).toLowerCase();
    const { offset, limit, ...filters } = query;
    for (const key of ['cameraId', 'zoneId', 'offset', 'limit'])
      if (query[key] !== undefined && typeof query[key] !== 'string') invalid();
    const filter = command(EpisodeFilters, filters);
    const page = pagination(offset as string | undefined, limit as string | undefined);
    const schema = this.db.driver.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema) > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      throw new Error('SAFETY_EPISODE_SCHEMA_UNAVAILABLE');
    const scope = '"' + schema.replaceAll('"', '""') + '"';
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.auth.authenticateRequest(request, manager);
      const user = request.user;
      if (!user)
        throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        });
      if (user.mustChangePassword)
        throw new PublicHttpException(HttpStatus.FORBIDDEN, {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Password change required',
        });
      // Preserve existing Safety read roles: global Admin or current Site Safety Officer.
      const roles: { role: string; site_id: string | null }[] = await manager.query(
        `SELECT role,site_id FROM ${scope}.user_role_assignment WHERE user_id=$1 ORDER BY id FOR SHARE`,
        [user.id],
      );
      if (
        !roles.some(
          (role) =>
            (role.role === 'ADMIN' && role.site_id === null) ||
            (role.role === 'SAFETY_OFFICER' && role.site_id === siteId),
        )
      )
        throw new PublicHttpException(HttpStatus.FORBIDDEN, {
          code: 'FORBIDDEN',
          message: 'Forbidden',
        });
      const args = [
        siteId,
        filter.cameraId?.toLowerCase() ?? null,
        filter.zoneId?.toLowerCase() ?? null,
      ];
      const eligible = `e.site_id=$1 AND ($2::uuid IS NULL OR e.camera_id=$2)
        AND EXISTS(SELECT 1 FROM ${scope}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id AND ($3::uuid IS NULL OR a.zone_id=$3))`;
      const [count]: { total: number }[] = await manager.query(
        `SELECT count(*)::int AS total FROM ${scope}.safety_episode e WHERE ${eligible}`,
        args,
      );
      const rows: {
        id: string;
        site_id: string;
        camera_id: string;
        event_id: string;
        person_observation_index: number;
        first_observed_at: Date;
        last_observed_at: Date;
        content_revision: number;
        collection_state: 'COLLECTING' | 'SEALED';
        finding_count: number;
      }[] = await manager.query(
        `SELECT e.id,e.site_id,e.camera_id,e.event_id,e.person_observation_index,
        e.first_observed_at,e.last_observed_at,e.content_revision,e.collection_state,
        (SELECT count(*)::int FROM ${scope}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id) AS finding_count
        FROM ${scope}.safety_episode e WHERE ${eligible}
        ORDER BY e.last_observed_at DESC,e.id DESC OFFSET $4 LIMIT $5`,
        [...args, page.offset, page.limit],
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
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
        })),
        total: count?.total ?? 0,
      };
    });
  }
}
