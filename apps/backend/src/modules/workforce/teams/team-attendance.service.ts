import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, IsNull } from 'typeorm';
import {
  scheduledShiftWindow,
  type ScheduleTeamAttendanceResponse,
  type TeamAttendanceMemberResponse,
} from '@smartsite/contracts';
import {
  AccessAuditEntity,
  AttendanceDayEntity,
  ContractorTeamEntity,
  ContractorTeamMembershipEntity,
  ShiftEntity,
  TeamAttendanceEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerScheduleEntity,
} from '../../../database/entities/index.js';
import {
  command,
  conflict,
  invalid,
  missing,
  knownUnique,
  uuid,
} from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { hasActiveContractorParticipation } from '../shared/contractor-participation.js';
import { auditAccess } from '../shared/access-audit.js';
import { SubmitTeamAttendanceDto } from './dto/team-attendance.dto.js';
import { AttendanceReconciliationService } from '../attendance/attendance-reconciliation.service.js';

function denied(): never {
  throw new PublicHttpException(403, {
    code: 'FORBIDDEN',
    message: 'Team attendance is outside your scope',
  });
}

@Injectable()
export class TeamAttendanceService {
  constructor(
    private readonly source: DataSource,
    private readonly reconciliation: AttendanceReconciliationService,
  ) {}

  private async context(
    m: EntityManager,
    actor: AuthenticatedUser,
    siteId: string,
    scheduleId: string,
    lock = false,
  ) {
    const user = await m
      .getRepository(UserEntity)
      .findOneBy({ id: actor.id, isActive: true, mustChangePassword: false });
    if (
      !user ||
      actor.mustChangePassword ||
      !(await m
        .getRepository(UserRoleAssignmentEntity)
        .existsBy({ userId: actor.id, siteId, role: UserRole.WORKER }))
    )
      denied();
    const worker = await m
      .getRepository(WorkerEntity)
      .findOneBy({ userId: actor.id, siteId, isActive: true });
    if (
      !worker?.contractorId ||
      !(await hasActiveContractorParticipation(m, worker.contractorId, siteId))
    )
      denied();
    const schedule = await m
      .getRepository(WorkerScheduleEntity)
      .findOneBy({ id: scheduleId, siteId, workerId: worker.id });
    if (!schedule) missing();
    const membership = await m.getRepository(ContractorTeamMembershipEntity).findOneBy({
      workerId: worker.id,
      siteId,
      contractorId: worker.contractorId,
      leftAt: IsNull(),
    });
    const team = membership
      ? await m.getRepository(ContractorTeamEntity).findOne({
          where: {
            id: membership.teamId,
            siteId,
            contractorId: worker.contractorId,
            isActive: true,
          },
          ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
        })
      : null;
    // Recheck after obtaining the team lock; transfers and leader changes use the same lock.
    const stillMember =
      team &&
      (await m
        .getRepository(ContractorTeamMembershipEntity)
        .existsBy({ id: membership!.id, leftAt: IsNull() }));
    const activeTeam = stillMember ? team : null;
    const shift = await m.getRepository(ShiftEntity).findOneBy({ id: schedule.shiftId, siteId });
    if (!shift) missing();
    const window = scheduledShiftWindow(shift, schedule.workDate);
    const zones = activeTeam
      ? ((await m.query(
          `SELECT z.id, z.name FROM team_zone_permission p
      JOIN contractor_zone_permission cp ON cp.id=p.contractor_zone_permission_id
      JOIN contractor_site_participation csp ON csp.id=cp.site_contractor_id
      JOIN zone z ON z.id=cp.zone_id
      WHERE p.team_id=$1 AND csp.site_id=$2 AND csp.contractor_id=$3 AND z.site_id=$2 AND z.deleted_at IS NULL
      AND p.valid_from <= $4 AND p.valid_until > $4 AND (p.revoked_at IS NULL OR p.revoked_at > $4)
      AND cp.valid_from <= $4 AND cp.valid_until > $4 AND (cp.revoked_at IS NULL OR cp.revoked_at > $4)
      AND csp.valid_from <= $4 AND (csp.valid_until IS NULL OR csp.valid_until > $4) AND csp.is_active`,
          [activeTeam.id, siteId, worker.contractorId, window.startsAt],
        )) as { id: string; name: string }[])
      : [];
    const zone = zones.length === 1 ? zones[0]! : null;
    return {
      worker,
      schedule,
      team: activeTeam,
      zone,
      window,
      canManage: !!activeTeam && activeTeam.leaderWorkerId === worker.id,
    };
  }

  private async member(
    m: EntityManager,
    schedule: WorkerScheduleEntity,
    displayName: string,
    teamId?: string,
    membershipId?: string,
  ): Promise<TeamAttendanceMemberResponse> {
    const record = await m
      .getRepository(TeamAttendanceEntity)
      .findOneBy({ scheduleId: schedule.id });
    const day = await m.getRepository(AttendanceDayEntity).findOneBy({
      siteId: schedule.siteId,
      workerId: schedule.workerId,
      workDate: schedule.workDate,
    });
    const [gate] = (await m.query(
      `SELECT EXISTS(SELECT 1 FROM attendance_event WHERE shift_assignment_id=$1 AND site_id=$2 AND worker_id=$3 AND kind='CHECK_IN' AND gate_event_id IS NOT NULL) AS entered`,
      [schedule.id, schedule.siteId, schedule.workerId],
    )) as { entered: boolean }[];
    const entered = !!gate?.entered;
    return {
      scheduleId: schedule.id,
      membershipId: membershipId ?? record?.membershipId ?? null,
      workerId: schedule.workerId,
      displayName,
      status: record?.status ?? 'NOT_YET',
      version: record?.version ?? 0,
      updatedAt: record?.updatedAt.toISOString() ?? null,
      gateCheck:
        record?.status === 'PRESENT'
          ? entered
            ? 'MATCHED'
            : 'NO_GATE_ENTRY'
          : entered
            ? 'GATE_ONLY'
            : 'NOT_YET',
      locked:
        !schedule.isActive ||
        day?.status === 'CONFIRMED' ||
        (!!record &&
          !!teamId &&
          (record.teamId !== teamId || record.membershipId !== membershipId)),
    };
  }

  private async read(
    m: EntityManager,
    actor: AuthenticatedUser,
    siteId: string,
    scheduleId: string,
  ): Promise<ScheduleTeamAttendanceResponse> {
    const c = await this.context(m, actor, siteId, scheduleId);
    const own = await this.member(m, c.schedule, c.worker.displayName);
    let members: TeamAttendanceMemberResponse[] = [];
    if (c.canManage && c.team) {
      const roster = (await m.query(
        `SELECT s.id AS "scheduleId", w.id AS "workerId", w.display_name AS "displayName", tm.id AS "membershipId",
        COALESCE(a.status,'NOT_YET') AS status, COALESCE(a.version,0) AS version, a.updated_at AS "updatedAt",
        (d.status='CONFIRMED' OR (a.schedule_id IS NOT NULL AND (a.team_id<>tm.team_id OR a.membership_id<>tm.id))) IS TRUE AS locked,
        EXISTS(SELECT 1 FROM attendance_event e WHERE e.shift_assignment_id=s.id AND e.site_id=s.site_id AND e.worker_id=s.worker_id AND e.kind='CHECK_IN' AND e.gate_event_id IS NOT NULL) AS entered
        FROM worker_schedule s JOIN worker w ON w.id=s.worker_id AND w.site_id=s.site_id
        JOIN contractor_team_membership tm ON tm.worker_id=w.id AND tm.site_id=w.site_id AND tm.contractor_id=w.contractor_id
        LEFT JOIN team_attendance a ON a.schedule_id=s.id
        LEFT JOIN attendance_day d ON d.site_id=s.site_id AND d.worker_id=s.worker_id AND d.work_date=s.work_date
        WHERE tm.team_id=$1 AND tm.left_at IS NULL AND w.is_active AND w.contractor_id=$2
        AND s.site_id=$3 AND s.work_date=$4 AND s.shift_id=$5 AND s.schedule_version_id=$6 AND s.is_active
        ORDER BY w.display_name,w.id`,
        [
          c.team.id,
          c.team.contractorId,
          siteId,
          c.schedule.workDate,
          c.schedule.shiftId,
          c.schedule.scheduleVersionId,
        ],
      )) as (Omit<TeamAttendanceMemberResponse, 'gateCheck' | 'updatedAt'> & {
        entered: boolean;
        updatedAt: Date | null;
      })[];
      members = roster.map(({ entered, updatedAt, ...row }) => ({
        ...row,
        updatedAt: updatedAt?.toISOString() ?? null,
        gateCheck:
          row.status === 'PRESENT'
            ? entered
              ? 'MATCHED'
              : 'NO_GATE_ENTRY'
            : entered
              ? 'GATE_ONLY'
              : 'NOT_YET',
      }));
    }
    // Historical evidence retains its Zone even after a worker's team changes.
    const historical = (await m.query(
      `SELECT z.id,z.name FROM team_attendance a JOIN zone z ON z.id=a.zone_id WHERE a.schedule_id=$1`,
      [scheduleId],
    )) as { id: string; name: string }[];
    const zone = c.canManage ? c.zone : (historical[0] ?? c.zone);
    return {
      own,
      teamId: c.team?.id ?? null,
      teamName: c.team?.name ?? null,
      zoneId: zone?.id ?? null,
      zoneName: zone?.name ?? null,
      canManage: c.canManage,
      canSubmit:
        c.canManage &&
        !!c.zone &&
        c.schedule.isActive &&
        new Date() >= c.window.startsAt &&
        members.some((v) => !v.locked),
      members,
    };
  }

  get(actor: AuthenticatedUser, site: string, schedule: string) {
    const siteId = uuid(site).toLowerCase(),
      scheduleId = uuid(schedule).toLowerCase();
    return this.source.transaction('REPEATABLE READ', (m) =>
      this.read(m, actor, siteId, scheduleId),
    );
  }

  async submit(
    actor: AuthenticatedUser,
    site: string,
    schedule: string,
    input: SubmitTeamAttendanceDto,
  ) {
    const siteId = uuid(site).toLowerCase(),
      scheduleId = uuid(schedule).toLowerCase(),
      value = command(SubmitTeamAttendanceDto, input);
    return this.source
      .transaction(async (m) => {
        const c = await this.context(m, actor, siteId, scheduleId, true);
        if (!c.canManage || !c.team || c.team.id !== value.teamId) denied();
        const previous = await m
          .getRepository(AccessAuditEntity)
          .findOneBy({ entityId: value.requestId, action: 'TEAM_ATTENDANCE_SUBMITTED' });
        const fingerprint = JSON.stringify({
          scheduleId,
          teamId: value.teamId,
          zoneId: value.zoneId,
          reason: value.reason ?? '',
          entries: [...value.entries].sort((a, b) => a.scheduleId.localeCompare(b.scheduleId)),
        });
        if (previous) {
          if (
            previous.actorAccountId !== actor.id ||
            previous.siteId !== siteId ||
            previous.changes?.fingerprint !== fingerprint
          )
            conflict();
          return this.read(m, actor, siteId, scheduleId);
        }
        if (!c.zone || c.zone.id !== value.zoneId)
          conflict('Assigned zone changed; reload attendance');
        const view = await this.read(m, actor, siteId, scheduleId);
        if (!view.canSubmit) conflict('Team attendance is not editable');
        const before: TeamAttendanceEntity[] = [];
        for (const entry of [...value.entries].sort((a, b) =>
          a.scheduleId.localeCompare(b.scheduleId),
        )) {
          const row = view.members.find((v) => v.scheduleId === entry.scheduleId);
          if (!row) denied();
          const target = await m.getRepository(WorkerScheduleEntity).findOne({
            where: { id: entry.scheduleId, siteId, isActive: true },
            lock: { mode: 'pessimistic_write' },
          });
          if (!target) conflict();
          // Lock the day as well so a concurrent payroll confirmation cannot race a correction.
          const day = await m.getRepository(AttendanceDayEntity).findOne({
            where: { siteId, workerId: target.workerId, workDate: target.workDate },
            lock: { mode: 'pessimistic_write' },
          });
          if (row.locked || day?.status === 'CONFIRMED') conflict('Attendance was finalized');
          const record = await m
            .getRepository(TeamAttendanceEntity)
            .findOneBy({ scheduleId: entry.scheduleId });
          if ((record?.version ?? 0) !== entry.expectedVersion)
            conflict('Team attendance changed; reload before updating');
          if (record && (!value.reason || value.reason.trim().length < 5))
            invalid('A correction reason of at least five characters is required');
          if (record) before.push(record);
          const membership = await m
            .getRepository(ContractorTeamMembershipEntity)
            .findOneBy({ teamId: c.team.id, workerId: target.workerId, leftAt: IsNull() });
          if (!membership || membership.id !== entry.expectedMembershipId)
            conflict('Team membership changed; reload attendance');
          await m.getRepository(TeamAttendanceEntity).save({
            scheduleId: target.id,
            teamId: c.team.id,
            membershipId: membership.id,
            zoneId: c.zone.id,
            status: entry.status,
            version: entry.expectedVersion + 1,
            updatedBy: actor.id,
            updatedAt: new Date(),
          });
          if (day) await this.reconciliation.refresh(m, day.id);
        }
        await auditAccess(
          m,
          actor.id,
          siteId,
          'TEAM_ATTENDANCE_SUBMITTED',
          'team_attendance_submission',
          value.requestId,
          value.reason ?? null,
          { fingerprint, before, after: value.entries, teamId: c.team.id, zoneId: c.zone.id },
        );
        return this.read(m, actor, siteId, scheduleId);
      })
      .catch((error: unknown) => knownUnique(error, ['uq_team_attendance_request']));
  }
}
