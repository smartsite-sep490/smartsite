import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { IsDateString, IsString, Matches, MaxLength, IsOptional, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import type {
  SafetyOverviewQuery,
  SafetyOverviewResponse,
  SafetyOverviewTeam,
  SafetyOverviewWorker,
  SafetyTeamDetailResponse,
} from '@smartsite/contracts';
import { command, invalid, missing, page, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
export class SafetyOverviewFilters {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() @MaxLength(64) timezone!: string;
  @IsOptional() @IsUUID() contractorId?: string;
  @IsOptional() @IsUUID() teamId?: string;
}
// Export the recorded grant query so overview counts and alert drill-down use the same time scope.
export const safetyTeamZoneContextSql = `(
 SELECT tp.team_id,t.site_id,cp.zone_id,
 GREATEST(tp.valid_from,cp.valid_from,p.valid_from) AS valid_from,
 LEAST(tp.valid_until,cp.valid_until,COALESCE(p.valid_until,tp.valid_until),COALESCE(tp.revoked_at,tp.valid_until),COALESCE(cp.revoked_at,tp.valid_until)) AS valid_until
 FROM team_zone_permission tp JOIN contractor_team t ON t.id=tp.team_id
 JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id
 JOIN contractor_site_participation p ON p.id=cp.site_contractor_id AND p.site_id=t.site_id AND p.contractor_id=t.contractor_id
 JOIN zone z ON z.id=cp.zone_id AND z.site_id=t.site_id WHERE p.is_active
)`;
const workerProjection = `WITH scheduled AS (
  SELECT ws.worker_id,s.name AS shift_name,
   ((ws.work_date+(s.starts_at AT TIME ZONE s.timezone)::time) AT TIME ZONE s.timezone) AS starts_at,
   ((ws.work_date+(s.ends_at AT TIME ZONE s.timezone)::time+(((s.ends_at AT TIME ZONE s.timezone)::date-(s.starts_at AT TIME ZONE s.timezone)::date)*interval '1 day')) AT TIME ZONE s.timezone) AS ends_at
  FROM worker_schedule ws JOIN shift s ON s.id=ws.shift_id AND s.site_id=ws.site_id
  WHERE ws.site_id=$1 AND ws.work_date=$2::date AND ws.is_active
)
SELECT w.id,w.display_name AS "displayName",w.external_id AS "externalId",w.contractor_id AS "contractorId",
 w.is_active AS "isActive",tm.team_id AS "teamId",s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.shift_name AS "shiftName"
FROM worker w LEFT JOIN scheduled s ON s.worker_id=w.id
LEFT JOIN LATERAL (
 SELECT team_id FROM contractor_team_membership m WHERE m.worker_id=w.id AND m.site_id=w.site_id AND m.contractor_id=w.contractor_id
 AND m.joined_at<=COALESCE(s.starts_at,LEAST(CURRENT_TIMESTAMP,(($2::date+1)::timestamp AT TIME ZONE $3)-interval '1 microsecond'))
 AND (m.left_at IS NULL OR m.left_at>COALESCE(s.starts_at,LEAST(CURRENT_TIMESTAMP,(($2::date+1)::timestamp AT TIME ZONE $3)-interval '1 microsecond')))
 ORDER BY m.joined_at DESC,m.id DESC LIMIT 1
) tm ON TRUE
WHERE w.site_id=$1 AND w.created_at < (($2::date+1)::timestamp AT TIME ZONE $3)
AND (w.is_active OR s.worker_id IS NOT NULL)
AND ($4::uuid IS NULL OR w.contractor_id=$4)
ORDER BY w.display_name,w.id`;
@Injectable()
export class SafetyWorkContextService {
  constructor(private readonly source: DataSource) {}
  async scope(m: EntityManager, actor: AuthenticatedUser, siteId: string) {
    const rows = (await m.query(
      `SELECT s.id,s.code,s.name FROM site s
      WHERE s.id=$1 AND EXISTS(SELECT 1 FROM app_user u WHERE u.id=$2 AND u.is_active AND NOT u.must_change_password)
      AND EXISTS(SELECT 1 FROM user_role_assignment r WHERE r.user_id=$2 AND ((r.role='ADMIN' AND r.site_id IS NULL) OR (r.site_id=s.id AND r.role IN ('SAFETY_OFFICER','SITE_MANAGER'))))`,
      [uuid(siteId), actor.id],
    )) as { id: string; code: string; name: string }[];
    if (!rows.length)
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'Safety overview access to this Site is required',
      });
    return rows[0]!;
  }
  private filters(input: SafetyOverviewQuery) {
    const raw = Object.fromEntries(
      Object.entries(input).filter(
        ([key]) => !['offset', 'limit', 'unassignedOffset', 'unassignedLimit'].includes(key),
      ),
    );
    const query = command(SafetyOverviewFilters, raw);
    try {
      new Intl.DateTimeFormat('en', { timeZone: query.timezone }).format();
    } catch {
      invalid('Invalid timezone');
    }
    return query;
  }
  private async workers(
    m: EntityManager,
    siteId: string,
    q: SafetyOverviewFilters,
  ): Promise<SafetyOverviewWorker[]> {
    const rows = (await m.query(workerProjection, [
      siteId,
      q.date,
      q.timezone,
      q.contractorId ?? null,
    ])) as (Omit<SafetyOverviewWorker, 'startsAt' | 'endsAt'> & {
      startsAt: Date | null;
      endsAt: Date | null;
    })[];
    return rows.map((r) => ({
      ...r,
      startsAt: r.startsAt?.toISOString() ?? null,
      endsAt: r.endsAt?.toISOString() ?? null,
    }));
  }
  async contractors(actor: AuthenticatedUser, siteId: string, input: SafetyOverviewQuery) {
    const q = this.filters(input),
      paging = page(input.offset, input.limit);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId);
      const rows = (await m.query(
        `SELECT c.id,c.name FROM contractor c WHERE
       EXISTS(SELECT 1 FROM contractor_team t WHERE t.contractor_id=c.id AND t.site_id=$1 AND t.created_at<(($2::date+1)::timestamp AT TIME ZONE $3))
       OR EXISTS(SELECT 1 FROM worker w WHERE w.contractor_id=c.id AND w.site_id=$1 AND w.created_at<(($2::date+1)::timestamp AT TIME ZONE $3))
       ORDER BY c.name,c.id`,
        [siteId, q.date, q.timezone],
      )) as { id: string; name: string }[];
      return { items: rows.slice(paging.offset, paging.offset + paging.limit), total: rows.length };
    });
  }
  async overview(
    actor: AuthenticatedUser,
    siteId: string,
    input: SafetyOverviewQuery,
  ): Promise<SafetyOverviewResponse> {
    const q = this.filters(input),
      paging = page(input.offset, input.limit),
      unassignedPaging = page(input.unassignedOffset, input.unassignedLimit);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const site = await this.scope(m, actor, siteId);
      const teams = (await m.query(
        `SELECT t.id,t.name,t.description,t.contractor_id AS "contractorId",c.name AS "contractorName",t.is_active AS "isActive"
        FROM contractor_team t JOIN contractor c ON c.id=t.contractor_id WHERE t.site_id=$1
        AND t.created_at< (($2::date+1)::timestamp AT TIME ZONE $3)
        AND ($4::uuid IS NULL OR t.contractor_id=$4) AND ($5::uuid IS NULL OR t.id=$5) ORDER BY c.name,t.name,t.id`,
        [siteId, q.date, q.timezone, q.contractorId ?? null, q.teamId ?? null],
      )) as SafetyOverviewTeam[];
      const workers = await this.workers(m, siteId, q);
      for (const t of teams) {
        const members = workers.filter((w) => w.teamId === t.id);
        t.workerCount = new Set(members.map((w) => w.id)).size;
        t.scheduledWorkerCount = new Set(members.filter((w) => w.startsAt).map((w) => w.id)).size;
      }
      const unassigned = q.teamId ? [] : workers.filter((w) => !w.teamId);
      return {
        site,
        date: q.date,
        timezone: q.timezone,
        teams: {
          items: teams.slice(paging.offset, paging.offset + paging.limit),
          total: teams.length,
        },
        unassignedWorkers: {
          items: unassigned.slice(
            unassignedPaging.offset,
            unassignedPaging.offset + unassignedPaging.limit,
          ),
          total: unassigned.length,
        },
      };
    });
  }
  async team(
    actor: AuthenticatedUser,
    siteId: string,
    teamId: string,
    input: SafetyOverviewQuery,
  ): Promise<SafetyTeamDetailResponse> {
    const q = this.filters(input),
      paging = page(input.offset, input.limit);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      await this.scope(m, actor, siteId);
      const [team] = (await m.query(
        `SELECT t.id,t.name,t.description,t.contractor_id AS "contractorId",c.name AS "contractorName",t.is_active AS "isActive" FROM contractor_team t JOIN contractor c ON c.id=t.contractor_id WHERE t.site_id=$1 AND t.id=$2 AND ($3::uuid IS NULL OR t.contractor_id=$3)`,
        [siteId, uuid(teamId), q.contractorId ?? null],
      )) as SafetyOverviewTeam[];
      if (!team) missing();
      const workers = (
        await this.workers(m, siteId, { ...q, contractorId: team.contractorId })
      ).filter((w) => w.teamId === teamId);
      const rows = (await m.query(
        `SELECT z.id,z.name,z.code,GREATEST(tp.valid_from,cp.valid_from,p.valid_from) AS "validFrom",
        LEAST(tp.valid_until,cp.valid_until,COALESCE(p.valid_until,tp.valid_until),COALESCE(tp.revoked_at,tp.valid_until),COALESCE(cp.revoked_at,tp.valid_until)) AS "validUntil"
        FROM team_zone_permission tp JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id
        JOIN contractor_site_participation p ON p.id=cp.site_contractor_id JOIN zone z ON z.id=cp.zone_id
        WHERE tp.team_id=$1 AND p.site_id=$2 AND p.contractor_id=$3 AND z.site_id=$2
        AND p.is_active AND tp.valid_from< (($4::date+1)::timestamp AT TIME ZONE $5)
        AND tp.valid_until>($4::date::timestamp AT TIME ZONE $5)
        AND (tp.revoked_at IS NULL OR tp.revoked_at>($4::date::timestamp AT TIME ZONE $5))
        AND (cp.revoked_at IS NULL OR cp.revoked_at>($4::date::timestamp AT TIME ZONE $5))
        ORDER BY z.name,tp.valid_from,tp.id`,
        [teamId, siteId, team.contractorId, q.date, q.timezone],
      )) as { id: string; name: string; code: string; validFrom: Date; validUntil: Date }[];
      return {
        ...team,
        date: q.date,
        timezone: q.timezone,
        workerCount: new Set(workers.map((w) => w.id)).size,
        scheduledWorkerCount: new Set(workers.filter((w) => w.startsAt).map((w) => w.id)).size,
        workers: {
          items: workers.slice(paging.offset, paging.offset + paging.limit),
          total: workers.length,
        },
        zones: rows
          .filter((z) => z.validUntil > z.validFrom)
          .map((z) => ({
            ...z,
            validFrom: z.validFrom.toISOString(),
            validUntil: z.validUntil.toISOString(),
          })),
        cameras: [],
      };
    });
  }
  async subjects(m: EntityManager, siteId: string, workerIds: string[], at: Date) {
    if (!workerIds.length) return [];
    return m.query(
      `SELECT w.id,w.display_name AS "displayName",w.contractor_id AS "contractorId",c.name AS "contractorName",t.id AS "teamId",t.name AS "teamName"
      FROM worker w LEFT JOIN contractor c ON c.id=w.contractor_id
      LEFT JOIN contractor_team_membership tm ON tm.worker_id=w.id AND tm.site_id=w.site_id AND tm.contractor_id=w.contractor_id AND tm.joined_at<=$3 AND (tm.left_at IS NULL OR tm.left_at>$3)
      LEFT JOIN contractor_team t ON t.id=tm.team_id AND t.site_id=w.site_id AND t.contractor_id=w.contractor_id
      WHERE w.site_id=$1 AND w.id=ANY($2::uuid[]) ORDER BY w.display_name,w.id`,
      [siteId, workerIds, at],
    ) as Promise<import('@smartsite/contracts').SafetyAlertWorkContextResponse['workers']>;
  }
}
