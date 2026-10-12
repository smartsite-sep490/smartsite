import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, In, IsNull } from 'typeorm';
import type {
  ContractorDashboardScope,
  ContractorDashboardResponse,
  ContractorTeamResponse,
  ContractorTeamWorkerResponse,
  TeamZoneSetupResponse,
  TeamZoneAssignmentResponse,
} from '@smartsite/contracts';
import {
  ContractorTeamEntity,
  ContractorTeamMembershipEntity,
  WorkerEntity,
  ContractorRepresentativeAssignmentEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  SiteEntity,
  ContractorEntity,
  TeamZonePermissionEntity,
  ContractorZonePermissionEntity,
  ContractorSiteParticipationEntity,
  ZoneEntity,
  AccessAuditEntity,
} from '../../../database/entities/index.js';
import {
  command,
  conflict,
  invalid,
  knownUnique,
  missing,
  page,
  uuid,
} from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { hasActiveContractorParticipation } from '../shared/contractor-participation.js';
import { auditAccess } from '../shared/access-audit.js';
import {
  ContractorTeamQueryDto,
  ContractorTeamWorkersQueryDto,
  CreateContractorTeamDto,
  UpdateContractorTeamDto,
  ArchiveContractorTeamDto,
  AssignContractorTeamDto,
  GrantTeamZoneDto,
} from './dto/contractor-team.dto.js';

@Injectable()
export class ContractorTeamsService {
  private async assignedZones(
    m: EntityManager,
    team: ContractorTeamEntity,
  ): Promise<TeamZoneAssignmentResponse[]> {
    const rows = (await m.query(
      `SELECT tp.id,cp.id AS "contractorZonePermissionId",z.id AS "zoneId",z.name,tp.valid_from AS "validFrom",tp.valid_until AS "validUntil",tp.revoked_at AS "revokedAt",
      (t.is_active AND p.is_active AND cp.revoked_at IS NULL AND tp.valid_from<=CURRENT_TIMESTAMP AND tp.valid_until>CURRENT_TIMESTAMP AND cp.valid_from<=CURRENT_TIMESTAMP AND cp.valid_until>CURRENT_TIMESTAMP AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP) AND tp.valid_from>=cp.valid_from AND tp.valid_until<=cp.valid_until AND tp.valid_from>=p.valid_from AND (p.valid_until IS NULL OR tp.valid_until<=p.valid_until)) AS effective
      FROM team_zone_permission tp JOIN contractor_team t ON t.id=tp.team_id JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id JOIN contractor_site_participation p ON p.id=cp.site_contractor_id AND p.site_id=t.site_id AND p.contractor_id=t.contractor_id JOIN zone z ON z.id=cp.zone_id AND z.site_id=t.site_id
      WHERE t.id=$1 AND t.site_id=$2 AND t.contractor_id=$3 AND tp.revoked_at IS NULL ORDER BY tp.created_at,tp.id`,
      [team.id, team.siteId, team.contractorId],
    )) as Array<
      Omit<TeamZoneAssignmentResponse, 'validFrom' | 'validUntil'> & {
        validFrom: Date;
        validUntil: Date;
      }
    >;
    return rows.map((r) => ({
      ...r,
      validFrom: r.validFrom.toISOString(),
      validUntil: r.validUntil.toISOString(),
    }));
  }
  async zoneSetup(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    teamValue: string,
  ): Promise<TeamZoneSetupResponse> {
    const siteId = uuid(siteValue),
      contractorId = uuid(contractorValue),
      teamId = uuid(teamValue);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      await this.scope(m, actor, siteId, contractorId);
      if (
        !(await m
          .getRepository(ContractorTeamEntity)
          .existsBy({ id: teamId, siteId, contractorId }))
      )
        missing();
      const available = (await m.query(
        `SELECT cp.id AS "permissionId",z.id AS "zoneId",z.name,cp.valid_from AS "validFrom",cp.valid_until AS "validUntil" FROM contractor_zone_permission cp JOIN contractor_site_participation p ON p.id=cp.site_contractor_id JOIN zone z ON z.id=cp.zone_id AND z.site_id=p.site_id WHERE p.site_id=$1 AND p.contractor_id=$2 AND p.is_active AND cp.revoked_at IS NULL AND cp.valid_until>CURRENT_TIMESTAMP AND cp.valid_from>=p.valid_from AND (p.valid_until IS NULL OR cp.valid_until<=p.valid_until) ORDER BY z.name,cp.valid_from,cp.id`,
        [siteId, contractorId],
      )) as {
        permissionId: string;
        zoneId: string;
        name: string;
        validFrom: Date;
        validUntil: Date;
      }[];
      const permissions = (await m.query(
        `SELECT tp.id,tp.contractor_zone_permission_id AS "contractorZonePermissionId",z.id AS "zoneId",z.name,tp.valid_from AS "validFrom",tp.valid_until AS "validUntil",tp.revoked_at AS "revokedAt",(tp.revoked_at IS NULL AND cp.revoked_at IS NULL AND t.is_active AND p.is_active AND tp.valid_from<=CURRENT_TIMESTAMP AND tp.valid_until>CURRENT_TIMESTAMP AND cp.valid_from<=CURRENT_TIMESTAMP AND cp.valid_until>CURRENT_TIMESTAMP AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP) AND tp.valid_from>=cp.valid_from AND tp.valid_until<=cp.valid_until AND tp.valid_from>=p.valid_from AND (p.valid_until IS NULL OR tp.valid_until<=p.valid_until)) AS effective FROM team_zone_permission tp JOIN contractor_team t ON t.id=tp.team_id JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id JOIN contractor_site_participation p ON p.id=cp.site_contractor_id AND p.site_id=t.site_id AND p.contractor_id=t.contractor_id JOIN zone z ON z.id=cp.zone_id AND z.site_id=t.site_id WHERE t.id=$3 AND t.site_id=$1 AND t.contractor_id=$2 ORDER BY z.name,tp.valid_from,tp.id`,
        [siteId, contractorId, teamId],
      )) as {
        id: string;
        contractorZonePermissionId: string;
        zoneId: string;
        name: string;
        validFrom: Date;
        validUntil: Date;
        revokedAt: Date | null;
        effective: boolean;
      }[];
      return {
        availableZones: available.map((p) => ({
          ...p,
          validFrom: p.validFrom.toISOString(),
          validUntil: p.validUntil.toISOString(),
        })),
        permissions: permissions.map((p) => ({
          ...p,
          validFrom: p.validFrom.toISOString(),
          validUntil: p.validUntil.toISOString(),
          revokedAt: p.revokedAt?.toISOString() ?? null,
        })),
      };
    });
  }
  async grantZone(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    teamValue: string,
    input: GrantTeamZoneDto,
    replacePermissionValue?: string,
  ) {
    const siteId = uuid(siteValue),
      contractorId = uuid(contractorValue),
      teamId = uuid(teamValue),
      value = command(GrantTeamZoneDto, input);
    const replaceId = replacePermissionValue ? uuid(replacePermissionValue) : null;
    if (value.endDate < value.startDate) invalid('End date must be on or after start date');
    try {
      const zone = new Intl.DateTimeFormat('en', { timeZone: value.timezone }).resolvedOptions()
        .timeZone;
      if (/^[+-]/.test(zone)) invalid();
      value.timezone = zone;
    } catch {
      invalid('Invalid IANA timezone');
    }
    return this.source
      .transaction(async (m) => {
        await this.scope(m, actor, siteId, contractorId);
        const team = await m.getRepository(ContractorTeamEntity).findOne({
          where: { id: teamId, siteId, contractorId, isActive: true },
          lock: { mode: 'pessimistic_write' },
        });
        if (!team) missing();
        const cp = await m.getRepository(ContractorZonePermissionEntity).findOne({
          where: { id: value.contractorZonePermissionId },
          lock: { mode: 'pessimistic_read' },
        });
        const p = cp
          ? await m.getRepository(ContractorSiteParticipationEntity).findOne({
              where: { id: cp.siteContractorId, siteId, contractorId, isActive: true },
              lock: { mode: 'pessimistic_read' },
            })
          : null;
        if (!cp || !p || !(await m.getRepository(ZoneEntity).existsBy({ id: cp.zoneId, siteId })))
          missing();
        if (cp.revokedAt || +cp.validUntil <= Date.now())
          conflict('Contractor Zone permission is no longer available');
        const [bounds] = (await m.query(
          `SELECT ($1::date::timestamp AT TIME ZONE $3) AS "from",(($2::date+1)::timestamp AT TIME ZONE $3) AS "until"`,
          [value.startDate, value.endDate, value.timezone],
        )) as { from: Date; until: Date }[];
        const from = new Date(Math.max(+bounds!.from, +cp.validFrom, +p.validFrom)),
          until = new Date(
            Math.min(+bounds!.until, +cp.validUntil, p.validUntil ? +p.validUntil : Infinity),
          );
        if (!Number.isFinite(+from) || !Number.isFinite(+until) || until <= from)
          conflict('Team dates must overlap the granted Contractor Zone period');
        const existing = await m
          .getRepository(TeamZonePermissionEntity)
          .findOneBy({ id: value.requestId });
        if (existing) {
          const creation = await m.getRepository(AccessAuditEntity).findOneBy({
            entityId: existing.id,
            entityType: 'team_zone_permission',
            action: 'TEAM_ZONE_GRANTED',
            siteId,
          });
          if (
            existing.teamId !== teamId ||
            existing.contractorZonePermissionId !== cp.id ||
            existing.grantedBy !== actor.id ||
            +existing.validFrom !== +from ||
            +existing.validUntil !== +until ||
            (creation?.changes?.replacesPermissionId ?? null) !== replaceId
          )
            conflict('Request was used for another team Zone');
          return { id: existing.id };
        }
        const current = await m
          .getRepository(TeamZonePermissionEntity)
          .findOne({ where: { teamId, revokedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
        if (replaceId) {
          if (!current || current.id !== replaceId)
            conflict('Team Zone changed. Reload before editing');
          current.revokedAt = new Date();
          await m.getRepository(TeamZonePermissionEntity).save(current);
          await auditAccess(
            m,
            actor.id,
            siteId,
            'TEAM_ZONE_REPLACED',
            'team_zone_permission',
            current.id,
            null,
            { teamId, replacementId: value.requestId },
          );
        } else if (current) conflict('Team already has a Zone. Edit the existing assignment');
        const permission = await m.getRepository(TeamZonePermissionEntity).save({
          id: value.requestId,
          teamId,
          contractorZonePermissionId: cp.id,
          validFrom: from,
          validUntil: until,
          grantedBy: actor.id,
          revokedAt: null,
        });
        await auditAccess(
          m,
          actor.id,
          siteId,
          'TEAM_ZONE_GRANTED',
          'team_zone_permission',
          permission.id,
          null,
          {
            teamId,
            contractorZonePermissionId: cp.id,
            replacesPermissionId: replaceId,
            validFrom: from.toISOString(),
            validUntil: until.toISOString(),
            startDate: value.startDate,
            endDate: value.endDate,
            timezone: value.timezone,
          },
        );
        return { id: permission.id };
      })
      .catch((error) => knownUnique(error, ['pk_team_zone_permission', 'uq_team_single_zone']));
  }
  async revokeZone(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    teamValue: string,
    permissionValue: string,
  ) {
    const siteId = uuid(siteValue),
      contractorId = uuid(contractorValue),
      teamId = uuid(teamValue),
      id = uuid(permissionValue);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId, contractorId);
      if (
        !(await m
          .getRepository(ContractorTeamEntity)
          .existsBy({ id: teamId, siteId, contractorId }))
      )
        missing();
      const permission = await m
        .getRepository(TeamZonePermissionEntity)
        .findOne({ where: { id, teamId }, lock: { mode: 'pessimistic_write' } });
      if (!permission) missing();
      if (!permission.revokedAt) {
        permission.revokedAt = new Date();
        await m.getRepository(TeamZonePermissionEntity).save(permission);
        await auditAccess(
          m,
          actor.id,
          siteId,
          'TEAM_ZONE_REVOKED',
          'team_zone_permission',
          id,
          null,
          { teamId },
        );
      }
      return { id };
    });
  }
  constructor(private readonly source: DataSource) {}
  private forbidden(): never {
    throw new PublicHttpException(403, {
      code: 'FORBIDDEN',
      message: 'Contractor team management is outside your scope',
    });
  }
  private async scope(
    m: EntityManager,
    actor: AuthenticatedUser,
    siteId: string,
    contractorId: string,
  ): Promise<ContractorDashboardScope> {
    const user = await m.getRepository(UserEntity).findOneBy({ id: actor.id, isActive: true });
    if (
      actor.mustChangePassword ||
      user?.mustChangePassword ||
      !user ||
      !(await m
        .getRepository(UserRoleAssignmentEntity)
        .existsBy({ userId: actor.id, siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE })) ||
      !(await m
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .existsBy({ userId: actor.id, siteId, contractorId })) ||
      !(await hasActiveContractorParticipation(m, contractorId, siteId))
    )
      this.forbidden();
    const site = await m.getRepository(SiteEntity).findOneBy({ id: siteId });
    const contractor = await m.getRepository(ContractorEntity).findOneBy({ id: contractorId });
    if (!site || !contractor) this.forbidden();
    return {
      siteId,
      contractorId,
      siteName: site.name,
      siteCode: site.code,
      contractorName: contractor.name,
    };
  }
  async scopes(actor: AuthenticatedUser) {
    const user = await this.source
      .getRepository(UserEntity)
      .findOneBy({ id: actor.id, isActive: true });
    if (!user) this.forbidden();
    const grants = await this.source
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .find({ where: { userId: actor.id }, order: { siteId: 'ASC', contractorId: 'ASC' } });
    const items: ContractorDashboardScope[] = [];
    for (const grant of grants) {
      try {
        items.push(await this.scope(this.source.manager, actor, grant.siteId, grant.contractorId));
      } catch (error) {
        if (!(error instanceof PublicHttpException && error.getStatus() === 403)) throw error;
      }
    }
    return { items };
  }
  async myTeam(actor: AuthenticatedUser, siteValue: string): Promise<ContractorTeamWorkerResponse> {
    const siteId = uuid(siteValue).toLowerCase();
    const user = await this.source
      .getRepository(UserEntity)
      .findOneBy({ id: actor.id, isActive: true });
    if (
      !user ||
      !(await this.source
        .getRepository(UserRoleAssignmentEntity)
        .existsBy({ userId: actor.id, siteId, role: UserRole.WORKER }))
    )
      this.forbidden();
    const worker = await this.source
      .getRepository(WorkerEntity)
      .findOneBy({ userId: actor.id, siteId, isActive: true });
    if (
      !worker?.contractorId ||
      !(await hasActiveContractorParticipation(this.source.manager, worker.contractorId, siteId))
    )
      this.forbidden();
    const member = await this.source.getRepository(ContractorTeamMembershipEntity).findOneBy({
      workerId: worker.id,
      siteId,
      contractorId: worker.contractorId,
      leftAt: IsNull(),
    });
    const team = member
      ? await this.source.getRepository(ContractorTeamEntity).findOneBy({
          id: member.teamId,
          siteId,
          contractorId: worker.contractorId,
          isActive: true,
        })
      : null;
    return {
      workerId: worker.id,
      displayName: worker.displayName,
      membershipId: team ? member!.id : null,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      zones: team ? await this.assignedZones(this.source.manager, team) : [],
    };
  }
  async dashboard(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
  ): Promise<ContractorDashboardResponse> {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase();
    return this.source.transaction('REPEATABLE READ', async (m) => {
      const scope = await this.scope(m, actor, siteId, contractorId);
      const [counts] = (await m.query(
        `SELECT
        (SELECT count(*) FROM worker WHERE site_id=$1 AND contractor_id=$2 AND is_active) AS workers,
        (SELECT count(*) FROM contractor_team WHERE site_id=$1 AND contractor_id=$2 AND is_active) AS teams,
        (SELECT count(*) FROM worker w WHERE w.site_id=$1 AND w.contractor_id=$2 AND w.is_active AND NOT EXISTS (
          SELECT 1 FROM contractor_team_membership tm JOIN contractor_team t ON t.id=tm.team_id AND t.is_active
          WHERE tm.worker_id=w.id AND tm.site_id=w.site_id AND tm.contractor_id=w.contractor_id AND tm.left_at IS NULL)) AS unassigned`,
        [siteId, contractorId],
      )) as Array<{ workers: string; teams: string; unassigned: string }>;
      return {
        scope,
        workerCount: Number(counts!.workers),
        teamCount: Number(counts!.teams),
        unassignedWorkerCount: Number(counts!.unassigned),
      };
    });
  }
  private async view(
    m: EntityManager,
    team: ContractorTeamEntity,
  ): Promise<ContractorTeamResponse> {
    const [counts] = (await m.query(
      `SELECT count(*) FROM contractor_team_membership tm JOIN worker w ON w.id=tm.worker_id
      WHERE tm.team_id=$1 AND tm.left_at IS NULL AND w.is_active AND w.site_id=tm.site_id AND w.contractor_id=tm.contractor_id`,
      [team.id],
    )) as Array<{ count: string }>;
    return {
      id: team.id,
      siteId: team.siteId,
      contractorId: team.contractorId,
      name: team.name,
      description: team.description,
      isActive: team.isActive,
      version: team.version,
      memberCount: Number(counts!.count),
      zoneAssignments: await this.assignedZones(m, team),
    };
  }
  async list(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    input: ContractorTeamQueryDto,
  ) {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase(),
      value = command(ContractorTeamQueryDto, input),
      pagination = page(value.offset, value.limit);
    await this.scope(this.source.manager, actor, siteId, contractorId);
    const q = this.source
      .getRepository(ContractorTeamEntity)
      .createQueryBuilder('t')
      .where('t.site_id=:siteId AND t.contractor_id=:contractorId', { siteId, contractorId });
    if (value.status !== 'ALL')
      q.andWhere('t.is_active=:active', { active: value.status !== 'ARCHIVED' });
    if (value.search)
      q.andWhere('t.name ILIKE :search', {
        search: `%${value.search.replace(/[\\%_]/g, '\\$&')}%`,
      });
    const [teams, total] = await q
      .orderBy('t.name', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();
    return { items: await Promise.all(teams.map((t) => this.view(this.source.manager, t))), total };
  }
  async detail(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    idValue: string,
  ) {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase(),
      id = uuid(idValue).toLowerCase();
    await this.scope(this.source.manager, actor, siteId, contractorId);
    const team = await this.source
      .getRepository(ContractorTeamEntity)
      .findOneBy({ id, siteId, contractorId });
    if (!team) missing();
    return this.view(this.source.manager, team);
  }
  async workers(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    input: ContractorTeamWorkersQueryDto,
  ) {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase(),
      value = command(ContractorTeamWorkersQueryDto, input),
      pagination = page(value.offset, value.limit);
    await this.scope(this.source.manager, actor, siteId, contractorId);
    if (value.teamId && value.unassigned) invalid('Choose either a team or unassigned workers');
    if (
      value.teamId &&
      !(await this.source
        .getRepository(ContractorTeamEntity)
        .existsBy({ id: value.teamId, siteId, contractorId }))
    )
      missing();
    const params: unknown[] = [siteId, contractorId];
    let filter = 'w.site_id=$1 AND w.contractor_id=$2 AND w.is_active';
    if (value.teamId) {
      params.push(value.teamId);
      filter += ` AND tm.team_id=$${params.length}`;
    }
    if (value.unassigned) filter += ' AND tm.id IS NULL';
    if (value.search) {
      params.push(`%${value.search.replace(/[\\%_]/g, '\\$&')}%`);
      filter += ` AND w.display_name ILIKE $${params.length}`;
    }
    const join = `FROM worker w LEFT JOIN contractor_team_membership tm ON tm.worker_id=w.id AND tm.site_id=w.site_id AND tm.contractor_id=w.contractor_id AND tm.left_at IS NULL
      LEFT JOIN contractor_team t ON t.id=tm.team_id WHERE ${filter}`;
    const [counts] = (await this.source.query(`SELECT count(*) ${join}`, params)) as Array<{
      count: string;
    }>;
    const items = (await this.source.query(
      `SELECT w.id AS "workerId",w.display_name AS "displayName",tm.id AS "membershipId",t.id AS "teamId",t.name AS "teamName" ${join}
      ORDER BY w.display_name,w.id OFFSET $${params.length + 1} LIMIT $${params.length + 2}`,
      [...params, pagination.offset, pagination.limit],
    )) as ContractorTeamWorkerResponse[];
    return { items, total: Number(counts!.count) };
  }
  async create(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    input: CreateContractorTeamDto,
  ) {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase(),
      value = command(CreateContractorTeamDto, input);
    try {
      return await this.source.transaction(async (m) => {
        await this.scope(m, actor, siteId, contractorId);
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `team-create:${value.requestId}`,
        ]);
        const repo = m.getRepository(ContractorTeamEntity),
          old = await repo.findOneBy({ id: value.requestId });
        if (old) {
          if (
            old.siteId !== siteId ||
            old.contractorId !== contractorId ||
            old.createdBy !== actor.id ||
            old.name !== value.name ||
            old.description !== (value.description ?? '')
          )
            conflict('Request ID was used for different team details');
          return this.view(m, old);
        }
        const team = await repo.save({
          id: value.requestId,
          siteId,
          contractorId,
          name: value.name,
          normalizedName: value.name.normalize('NFKC').toLowerCase(),
          description: value.description ?? '',
          createdBy: actor.id,
          isActive: true,
          version: 1,
        });
        await auditAccess(
          m,
          actor.id,
          siteId,
          'CONTRACTOR_TEAM_CREATED',
          'contractor_team',
          team.id,
          null,
          { contractorId, name: team.name },
        );
        return this.view(m, team);
      });
    } catch (error) {
      knownUnique(error, ['uq_team_active_name']);
    }
  }
  async update(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    idValue: string,
    input: UpdateContractorTeamDto,
  ) {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase(),
      id = uuid(idValue).toLowerCase(),
      value = command(UpdateContractorTeamDto, input);
    try {
      return await this.source.transaction(async (m) => {
        await this.scope(m, actor, siteId, contractorId);
        const team = await m
          .getRepository(ContractorTeamEntity)
          .findOne({ where: { id, siteId, contractorId }, lock: { mode: 'pessimistic_write' } });
        if (!team) missing();
        if (!team.isActive) conflict('Archived team cannot be edited');
        if (
          team.version === value.expectedVersion + 1 &&
          team.name === value.name &&
          team.description === value.description
        )
          return this.view(m, team);
        if (team.version !== value.expectedVersion) conflict('Team changed; reload before editing');
        const oldName = team.name;
        team.name = value.name;
        team.normalizedName = value.name.normalize('NFKC').toLowerCase();
        team.description = value.description;
        team.version++;
        await m.getRepository(ContractorTeamEntity).save(team);
        await auditAccess(
          m,
          actor.id,
          siteId,
          'CONTRACTOR_TEAM_UPDATED',
          'contractor_team',
          id,
          null,
          { oldName, name: team.name, version: team.version },
        );
        return this.view(m, team);
      });
    } catch (error) {
      knownUnique(error, ['uq_team_active_name']);
    }
  }
  async archive(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    idValue: string,
    input: ArchiveContractorTeamDto,
  ) {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase(),
      id = uuid(idValue).toLowerCase(),
      value = command(ArchiveContractorTeamDto, input);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId, contractorId);
      const team = await m
        .getRepository(ContractorTeamEntity)
        .findOne({ where: { id, siteId, contractorId }, lock: { mode: 'pessimistic_write' } });
      if (!team) missing();
      if (!team.isActive && team.version === value.expectedVersion + 1) return this.view(m, team);
      if (!team.isActive || team.version !== value.expectedVersion)
        conflict('Team changed; reload before archiving');
      const closed = (await m.query(
        `UPDATE contractor_team_membership tm SET left_at=GREATEST(now(),joined_at),ended_by=$2,end_reason=$3
        WHERE tm.team_id=$1 AND tm.left_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM worker w WHERE w.id=tm.worker_id AND w.site_id=tm.site_id AND w.contractor_id=tm.contractor_id AND w.is_active
        ) RETURNING tm.id`,
        [id, actor.id, value.reason],
      )) as unknown[];
      if (
        await m
          .getRepository(ContractorTeamMembershipEntity)
          .existsBy({ teamId: id, leftAt: IsNull() })
      )
        conflict('Move or remove all members before archiving this team');
      team.isActive = false;
      team.version++;
      await m.getRepository(ContractorTeamEntity).save(team);
      await auditAccess(
        m,
        actor.id,
        siteId,
        'CONTRACTOR_TEAM_ARCHIVED',
        'contractor_team',
        id,
        value.reason,
        { version: team.version, closedInactiveMemberships: closed },
      );
      return this.view(m, team);
    });
  }
  async assign(
    actor: AuthenticatedUser,
    siteValue: string,
    contractorValue: string,
    workerValue: string,
    input: AssignContractorTeamDto,
  ): Promise<ContractorTeamWorkerResponse> {
    const siteId = uuid(siteValue).toLowerCase(),
      contractorId = uuid(contractorValue).toLowerCase(),
      workerId = uuid(workerValue).toLowerCase(),
      value = command(AssignContractorTeamDto, input),
      reason = value.reason ?? '';
    try {
      return await this.source.transaction(async (m) => {
        await this.scope(m, actor, siteId, contractorId);
        const worker = await m.getRepository(WorkerEntity).findOne({
          where: { id: workerId, siteId, contractorId, isActive: true },
          lock: { mode: 'pessimistic_write' },
        });
        if (!worker) missing();
        const repo = m.getRepository(ContractorTeamMembershipEntity),
          current = await repo.findOneBy({ workerId, siteId, leftAt: IsNull() });
        const result = (
          membership: ContractorTeamMembershipEntity | null,
          team: ContractorTeamEntity | null,
        ): ContractorTeamWorkerResponse => ({
          workerId,
          displayName: worker.displayName,
          membershipId: membership?.id ?? null,
          teamId: team?.id ?? null,
          teamName: team?.name ?? null,
        });
        if (!current && value.teamId === null && value.expectedMembershipId === null)
          return result(null, null);
        const old = await repo.findOneBy({ id: value.requestId });
        if (old) {
          if (
            old.workerId !== workerId ||
            old.siteId !== siteId ||
            old.contractorId !== contractorId ||
            old.teamId !== value.teamId ||
            old.assignedBy !== actor.id ||
            old.reason !== reason ||
            old.leftAt ||
            current?.id !== old.id
          )
            conflict('Assignment request was reused or is no longer current');
          return result(
            old,
            await m
              .getRepository(ContractorTeamEntity)
              .findOneBy({ id: old.teamId, siteId, contractorId }),
          );
        }
        if (!current && value.teamId === null && value.expectedMembershipId) {
          const ended = await repo.findOneBy({
            id: value.expectedMembershipId,
            workerId,
            siteId,
            contractorId,
          });
          if (ended?.leftAt && ended.endedBy === actor.id && ended.endReason === reason)
            return result(null, null);
        }
        if ((current?.id ?? null) !== value.expectedMembershipId)
          conflict('Worker team changed; reload before assigning');
        const teamIds = [
          ...new Set([current?.teamId, value.teamId].filter((id): id is string => !!id)),
        ].sort();
        const teams = teamIds.length
          ? await m.getRepository(ContractorTeamEntity).find({
              where: { id: In(teamIds) },
              order: { id: 'ASC' },
              lock: { mode: 'pessimistic_write' },
            })
          : [];
        const target = value.teamId
          ? teams.find(
              (t) =>
                t.id === value.teamId &&
                t.siteId === siteId &&
                t.contractorId === contractorId &&
                t.isActive,
            )
          : null;
        if (value.teamId && !target) missing();
        if (current?.teamId === value.teamId) return result(current, target ?? null);
        const now = new Date();
        if (current) {
          current.leftAt = now;
          current.endedBy = actor.id;
          current.endReason = reason;
          await repo.save(current);
        }
        const membership = target
          ? await repo.save({
              id: value.requestId,
              siteId,
              contractorId,
              workerId,
              teamId: target.id,
              joinedAt: now,
              leftAt: null,
              assignedBy: actor.id,
              reason,
              endedBy: null,
              endReason: null,
            })
          : null;
        await auditAccess(
          m,
          actor.id,
          siteId,
          'CONTRACTOR_TEAM_MEMBERSHIP_CHANGED',
          'worker',
          workerId,
          reason,
          {
            previousMembershipId: current?.id ?? null,
            previousTeamId: current?.teamId ?? null,
            membershipId: membership?.id ?? null,
            teamId: target?.id ?? null,
          },
        );
        return result(membership, target ?? null);
      });
    } catch (error) {
      knownUnique(error, ['pk_team_membership_id', 'uq_team_worker_active']);
    }
  }
}
