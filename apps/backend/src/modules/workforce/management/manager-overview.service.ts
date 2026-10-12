import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { IsDateString, IsString, Matches, MaxLength } from 'class-validator';
import type {
  ManagerOverviewResponse,
  ManagerContractorDetailResponse,
  ManagerContractorSummary,
} from '@smartsite/contracts';
import { command, invalid, missing, page, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';

export class ManagerDetailQuery {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() @MaxLength(64) timezone!: string;
}

const participation = `EXISTS (SELECT 1 FROM contractor_site_participation p WHERE p.site_id=$1 AND p.contractor_id=c.id AND p.is_active AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP))`;
const summaryFields = `c.id,c.code,c.name,
  (SELECT count(*)::int FROM contractor_team t WHERE t.site_id=$1 AND t.contractor_id=c.id AND t.is_active) AS "teamCount",
  (SELECT count(*)::int FROM worker w WHERE w.site_id=$1 AND w.contractor_id=c.id AND w.is_active) AS "workerCount"`;

@Injectable()
export class ManagerOverviewService {
  constructor(private readonly source: DataSource) {}
  private async scope(m: EntityManager, actor: AuthenticatedUser, siteId: string) {
    const rows = (await m.query(
      `SELECT s.id,s.code,s.name FROM site s JOIN user_role_assignment r ON r.site_id=s.id AND r.role='SITE_MANAGER' JOIN app_user u ON u.id=r.user_id WHERE s.id=$1 AND u.id=$2 AND u.is_active AND NOT u.must_change_password`,
      [siteId, actor.id],
    )) as { id: string; code: string; name: string }[];
    if (
      !actor.isActive ||
      actor.mustChangePassword ||
      !actor.roleAssignments.some((r) => r.siteId === siteId && r.role === 'SITE_MANAGER') ||
      !rows.length
    )
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'Site Manager access to this Site is required',
      });
    return rows[0]!;
  }
  async overview(
    actor: AuthenticatedUser,
    siteValue: string,
    offset = 0,
    limit = 20,
  ): Promise<ManagerOverviewResponse> {
    const siteId = uuid(siteValue),
      paging = page(offset, limit);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const site = await this.scope(m, actor, siteId);
      const [counts] = (await m.query(
        `SELECT (SELECT count(*)::int FROM contractor c WHERE c.is_active AND ${participation}) AS "contractorCount", (SELECT count(*)::int FROM zone WHERE site_id=$1) AS "zoneCount", (SELECT count(*)::int FROM contractor_team t JOIN contractor c ON c.id=t.contractor_id WHERE t.site_id=$1 AND t.is_active AND c.is_active AND ${participation}) AS "teamCount", (SELECT count(*)::int FROM worker w JOIN contractor c ON c.id=w.contractor_id WHERE w.site_id=$1 AND w.is_active AND c.is_active AND ${participation}) AS "workerCount"`,
        [siteId],
      )) as {
        contractorCount: number;
        zoneCount: number;
        teamCount: number;
        workerCount: number;
      }[];
      const items = (await m.query(
        `SELECT ${summaryFields} FROM contractor c WHERE c.is_active AND ${participation} ORDER BY c.name,c.id OFFSET $2 LIMIT $3`,
        [siteId, paging.offset, paging.limit],
      )) as ManagerContractorSummary[];
      return { site, ...counts!, contractors: { items, total: counts!.contractorCount } };
    });
  }
  async detail(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    input: ManagerDetailQuery,
  ): Promise<ManagerContractorDetailResponse> {
    const siteId = uuid(siteValue),
      contractorId = uuid(contractorValue),
      query = command(ManagerDetailQuery, input);
    try {
      new Intl.DateTimeFormat('en', { timeZone: query.timezone }).format();
    } catch {
      invalid('Invalid timezone');
    }
    return this.source.transaction('REPEATABLE READ', async (m) => {
      await this.scope(m, actor, siteId);
      const [contractor] = (await m.query(
        `SELECT ${summaryFields} FROM contractor c WHERE c.id=$2 AND c.is_active AND ${participation}`,
        [siteId, contractorId],
      )) as ManagerContractorSummary[];
      if (!contractor) missing();
      const teams = (await m.query(
        `SELECT t.id,t.name,count(DISTINCT w.id)::int AS "workerCount" FROM contractor_team t LEFT JOIN contractor_team_membership tm ON tm.team_id=t.id AND tm.site_id=t.site_id AND tm.contractor_id=t.contractor_id AND tm.left_at IS NULL LEFT JOIN worker w ON w.id=tm.worker_id AND w.site_id=t.site_id AND w.contractor_id=t.contractor_id AND w.is_active WHERE t.site_id=$1 AND t.contractor_id=$2 AND t.is_active GROUP BY t.id ORDER BY t.name,t.id`,
        [siteId, contractorId],
      )) as ManagerContractorDetailResponse['teams'];
      const zoneRows = (await m.query(
        `SELECT z.id,z.code,z.name,cp.valid_from AS "validFrom",cp.valid_until AS "validUntil" FROM contractor_zone_permission cp JOIN contractor_site_participation p ON p.id=cp.site_contractor_id AND p.site_id=$1 AND p.contractor_id=$2 AND p.is_active JOIN zone z ON z.id=cp.zone_id AND z.site_id=$1 WHERE cp.revoked_at IS NULL AND cp.valid_from< (($3::date+1)::timestamp AT TIME ZONE $4) AND cp.valid_until>($3::date::timestamp AT TIME ZONE $4) AND p.valid_from< (($3::date+1)::timestamp AT TIME ZONE $4) AND (p.valid_until IS NULL OR p.valid_until>($3::date::timestamp AT TIME ZONE $4)) ORDER BY z.name,z.id,cp.id`,
        [siteId, contractorId, query.date, query.timezone],
      )) as { id: string; code: string; name: string; validFrom: Date; validUntil: Date }[];
      const schedules = (await m.query(
        `SELECT w.id AS "workerId",t.id AS "teamId",t.name AS "teamName",s.id AS "shiftId",s.name AS "shiftName",s.timezone,
        ((ws.work_date+(s.starts_at AT TIME ZONE s.timezone)::time) AT TIME ZONE s.timezone) AS "startsAt",
        ((ws.work_date+(s.ends_at AT TIME ZONE s.timezone)::time+(((s.ends_at AT TIME ZONE s.timezone)::date-(s.starts_at AT TIME ZONE s.timezone)::date)*interval '1 day')) AT TIME ZONE s.timezone) AS "endsAt"
        FROM worker_schedule ws JOIN worker w ON w.id=ws.worker_id AND w.site_id=ws.site_id AND w.contractor_id=$2 AND w.is_active JOIN shift s ON s.id=ws.shift_id AND s.site_id=ws.site_id
        LEFT JOIN contractor_team_membership tm ON tm.worker_id=w.id AND tm.site_id=w.site_id AND tm.contractor_id=w.contractor_id AND tm.left_at IS NULL
        LEFT JOIN contractor_team t ON t.id=tm.team_id AND t.site_id=w.site_id AND t.contractor_id=w.contractor_id AND t.is_active
        WHERE ws.site_id=$1 AND ws.work_date=$3::date AND ws.is_active ORDER BY t.name,s.starts_at,ws.id`,
        [siteId, contractorId, query.date],
      )) as {
        workerId: string;
        teamId: string | null;
        teamName: string | null;
        shiftId: string;
        shiftName: string;
        startsAt: Date;
        endsAt: Date;
        timezone: string;
      }[];
      const grouped = new Map<
        string,
        {
          id: string;
          name: string;
          workers: Set<string>;
          shifts: Map<
            string,
            ManagerContractorDetailResponse['scheduledTeams'][number]['shifts'][number]
          >;
        }
      >();
      for (const s of schedules) {
        if (!s.teamId) continue;
        let team = grouped.get(s.teamId);
        if (!team) {
          team = { id: s.teamId, name: s.teamName!, workers: new Set(), shifts: new Map() };
          grouped.set(s.teamId, team);
        }
        team.workers.add(s.workerId);
        team.shifts.set(s.shiftId, {
          id: s.shiftId,
          name: s.shiftName,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          timezone: s.timezone,
        });
      }
      return {
        ...contractor!,
        date: query.date,
        timezone: query.timezone,
        teams,
        zones: zoneRows.map((z) => ({
          ...z,
          validFrom: z.validFrom.toISOString(),
          validUntil: z.validUntil.toISOString(),
        })),
        scheduledTeams: [...grouped.values()].map((t) => ({
          id: t.id,
          name: t.name,
          workerCount: t.workers.size,
          shifts: [...t.shifts.values()],
        })),
        scheduledWorkerCount: new Set(schedules.map((s) => s.workerId)).size,
        scheduledWorkersWithoutTeam: new Set(
          schedules.filter((s) => !s.teamId).map((s) => s.workerId),
        ).size,
      };
    });
  }
}
