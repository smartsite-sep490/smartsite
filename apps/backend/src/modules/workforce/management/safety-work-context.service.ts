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
AND (tm.team_id=ANY($5::uuid[]) OR ($6::boolean AND tm.team_id IS NULL))`;
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
  private async teamPage(
    m: EntityManager,
    siteId: string,
    q: SafetyOverviewFilters,
    offset: number,
    limit: number,
  ) {
    const where =
      't.site_id=$1 AND t.created_at<(($2::date+1)::timestamp AT TIME ZONE $3) AND ($4::uuid IS NULL OR t.contractor_id=$4) AND ($5::uuid IS NULL OR t.id=$5)';
    const args = [siteId, q.date, q.timezone, q.contractorId ?? null, q.teamId ?? null];
    const [count] = await m.query(
      'SELECT count(*)::int AS total FROM contractor_team t WHERE ' + where,
      args,
    );
    const items = (await m.query(
      'SELECT t.id,t.name,t.description,t.contractor_id AS "contractorId",c.name AS "contractorName",t.is_active AS "isActive" FROM contractor_team t JOIN contractor c ON c.id=t.contractor_id WHERE ' +
        where +
        ' ORDER BY c.name,t.name,t.id LIMIT $6 OFFSET $7',
      [...args, limit, offset],
    )) as SafetyOverviewTeam[];
    return { items, total: count.total as number };
  }
  private workerArgs(
    siteId: string,
    q: SafetyOverviewFilters,
    teamIds: string[],
    unassigned = false,
  ) {
    return [siteId, q.date, q.timezone, q.contractorId ?? null, teamIds, unassigned];
  }
  private async workerPage(
    m: EntityManager,
    siteId: string,
    q: SafetyOverviewFilters,
    teamIds: string[],
    offset: number,
    limit: number,
    unassigned = false,
  ) {
    const args = this.workerArgs(siteId, q, teamIds, unassigned);
    const [count] = await m.query(
      'SELECT count(*)::int AS total FROM (' + workerProjection + ') w',
      args,
    );
    const rows = (await m.query(
      'SELECT * FROM (' +
        workerProjection +
        ') w ORDER BY "displayName",id,"startsAt" LIMIT $7 OFFSET $8',
      [...args, limit, offset],
    )) as (Omit<SafetyOverviewWorker, 'startsAt' | 'endsAt'> & {
      startsAt: Date | null;
      endsAt: Date | null;
    })[];
    return {
      total: count.total as number,
      items: rows.map((r) => ({
        ...r,
        startsAt: r.startsAt?.toISOString() ?? null,
        endsAt: r.endsAt?.toISOString() ?? null,
      })),
    };
  }
  async contractors(actor: AuthenticatedUser, siteId: string, input: SafetyOverviewQuery) {
    const q = this.filters(input),
      paging = page(input.offset, input.limit);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId);
      const where =
        'EXISTS(SELECT 1 FROM contractor_team t WHERE t.contractor_id=c.id AND t.site_id=$1 AND t.created_at<(($2::date+1)::timestamp AT TIME ZONE $3)) OR EXISTS(SELECT 1 FROM worker w WHERE w.contractor_id=c.id AND w.site_id=$1 AND w.created_at<(($2::date+1)::timestamp AT TIME ZONE $3))';
      const args = [siteId, q.date, q.timezone];
      const [count] = await m.query(
        'SELECT count(*)::int AS total FROM contractor c WHERE ' + where,
        args,
      );
      const items = (await m.query(
        'SELECT c.id,c.name FROM contractor c WHERE ' +
          where +
          ' ORDER BY c.name,c.id LIMIT $4 OFFSET $5',
        [...args, paging.limit, paging.offset],
      )) as { id: string; name: string }[];
      return { items, total: count.total as number };
    });
  }
  async teamOptions(actor: AuthenticatedUser, siteId: string, input: SafetyOverviewQuery) {
    const q = this.filters(input),
      paging = page(input.offset, input.limit);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId);
      return this.teamPage(m, siteId, q, paging.offset, paging.limit);
    });
  }
  async overview(
    actor: AuthenticatedUser,
    siteId: string,
    input: SafetyOverviewQuery,
  ): Promise<SafetyOverviewResponse> {
    const q = this.filters(input),
      paging = page(input.offset, input.limit),
      unassigned = page(input.unassignedOffset, input.unassignedLimit);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const site = await this.scope(m, actor, siteId),
        teams = await this.teamPage(m, siteId, q, paging.offset, paging.limit);
      const summaries = teams.items.length
        ? await m.query(
            `SELECT "teamId",count(DISTINCT id)::int AS "workerCount",count(DISTINCT id) FILTER(WHERE "startsAt" IS NOT NULL)::int AS "scheduledWorkerCount",COALESCE(jsonb_agg(DISTINCT jsonb_build_object('startsAt',"startsAt",'endsAt',"endsAt",'shiftName',"shiftName")) FILTER(WHERE "startsAt" IS NOT NULL),'[]'::jsonb) AS "workWindows" FROM (${workerProjection}) w GROUP BY "teamId"`,
            this.workerArgs(
              siteId,
              q,
              teams.items.map((t) => t.id),
            ),
          )
        : [];
      for (const t of teams.items)
        Object.assign(
          t,
          summaries.find((r: { teamId: string }) => r.teamId === t.id) ?? {
            workerCount: 0,
            scheduledWorkerCount: 0,
            workWindows: [],
          },
        );
      return {
        site,
        date: q.date,
        timezone: q.timezone,
        teams,
        unassignedWorkers: q.teamId
          ? { items: [], total: 0 }
          : await this.workerPage(m, siteId, q, [], unassigned.offset, unassigned.limit, true),
      };
    });
  }
  async week(
    actor: AuthenticatedUser,
    siteId: string,
    input: SafetyOverviewQuery,
  ): Promise<import('@smartsite/contracts').SafetyWeekResponse> {
    const q = this.filters(input),
      paging = page(input.offset, input.limit),
      day = new Date(q.date + 'T12:00:00Z');
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(day);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const site = await this.scope(m, actor, siteId),
        teams = await this.teamPage(
          m,
          siteId,
          { ...q, date: dates[6]! },
          paging.offset,
          paging.limit,
        );
      const rows = teams.items.length
        ? await m.query(
            `WITH scheduled AS (
        SELECT ws.worker_id,ws.work_date::text AS date,s.name AS "shiftName",
        ((ws.work_date+(s.starts_at AT TIME ZONE s.timezone)::time) AT TIME ZONE s.timezone) AS "startsAt",
        ((ws.work_date+(s.ends_at AT TIME ZONE s.timezone)::time+(((s.ends_at AT TIME ZONE s.timezone)::date-(s.starts_at AT TIME ZONE s.timezone)::date)*interval '1 day')) AT TIME ZONE s.timezone) AS "endsAt"
        FROM worker_schedule ws JOIN shift s ON s.id=ws.shift_id AND s.site_id=ws.site_id WHERE ws.site_id=$1 AND ws.is_active AND ws.work_date BETWEEN $2::date AND $3::date
      ) SELECT tm.team_id AS "teamId",s.date,count(DISTINCT w.id)::int AS "scheduledWorkerCount",jsonb_agg(DISTINCT jsonb_build_object('startsAt',s."startsAt",'endsAt',s."endsAt",'shiftName',s."shiftName")) AS "workWindows"
      FROM scheduled s JOIN worker w ON w.id=s.worker_id AND w.site_id=$1
      JOIN contractor_team_membership tm ON tm.worker_id=w.id AND tm.site_id=w.site_id AND tm.contractor_id=w.contractor_id AND tm.joined_at<=s."startsAt" AND (tm.left_at IS NULL OR tm.left_at>s."startsAt")
      WHERE tm.team_id=ANY($4::uuid[]) GROUP BY tm.team_id,s.date`,
            [siteId, dates[0], dates[6], teams.items.map((t) => t.id)],
          )
        : [];
      return {
        site,
        weekStart: dates[0]!,
        weekEnd: dates[6]!,
        timezone: q.timezone,
        updatedAt: new Date().toISOString(),
        teams: {
          total: teams.total,
          items: teams.items.map((t) => ({
            ...t,
            days: dates.map((date) => ({
              date,
              scheduledWorkerCount: 0,
              workWindows: [],
              ...rows.find(
                (r: { teamId: string; date: string }) => r.teamId === t.id && r.date === date,
              ),
            })),
          })),
        },
      };
    });
  }
  async zoneTeams(
    actor: AuthenticatedUser,
    siteId: string,
    zoneId: string,
    input: SafetyOverviewQuery,
  ) {
    const q = this.filters(input),
      paging = page(input.offset, input.limit);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId);
      if (
        !(await m.query('SELECT id FROM zone WHERE id=$1 AND site_id=$2', [uuid(zoneId), siteId]))
          .length
      )
        missing();
      const where = `g.site_id=$1 AND g.zone_id=$2 AND g.valid_from<(($3::date+1)::timestamp AT TIME ZONE $4) AND g.valid_until>($3::date::timestamp AT TIME ZONE $4)`;
      const args = [siteId, zoneId, q.date, q.timezone];
      const [count] = await m.query(
        'SELECT count(DISTINCT g.team_id)::int AS total FROM ' +
          safetyTeamZoneContextSql +
          ' g WHERE ' +
          where,
        args,
      );
      const items = await m.query(
        'SELECT DISTINCT t.id,t.name,t.description,t.contractor_id AS "contractorId",c.name AS "contractorName",t.is_active AS "isActive",0 AS "workerCount",0 AS "scheduledWorkerCount" FROM ' +
          safetyTeamZoneContextSql +
          ' g JOIN contractor_team t ON t.id=g.team_id JOIN contractor c ON c.id=t.contractor_id WHERE ' +
          where +
          ' ORDER BY c.name,t.name,t.id LIMIT $5 OFFSET $6',
        [...args, paging.limit, paging.offset],
      );
      return { items, total: count.total as number };
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
      const workers = await this.workerPage(
        m,
        siteId,
        { ...q, contractorId: team.contractorId },
        [teamId],
        paging.offset,
        paging.limit,
      );
      const [summary] = await m.query(
        `SELECT count(DISTINCT id)::int AS "workerCount",count(DISTINCT id) FILTER(WHERE "startsAt" IS NOT NULL)::int AS "scheduledWorkerCount",COALESCE(jsonb_agg(DISTINCT jsonb_build_object('startsAt',"startsAt",'endsAt',"endsAt",'shiftName',"shiftName")) FILTER(WHERE "startsAt" IS NOT NULL),'[]'::jsonb) AS "workWindows" FROM (${workerProjection}) w`,
        this.workerArgs(siteId, q, [teamId]),
      );
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
        ...summary,
        workers,
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
