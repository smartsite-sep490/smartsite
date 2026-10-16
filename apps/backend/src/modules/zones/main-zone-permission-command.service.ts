import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { z } from 'zod';
import { command, conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import {
  GrantContractorZoneCommand,
  GrantWorkerZoneCommand,
} from '../workforce/site-access-setup.commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { withZoneAuthorityTransaction } from './zone-authority-transaction.js';

const id = z.uuid().transform((v) => v.toLowerCase());
const instant = z.iso.datetime({ offset: true }).max(128);
const scope = { commandId: id, actorUserId: id, siteId: id };
const interval = { requestId: id, validFrom: instant, validUntil: instant };
const contractorSchema = z.strictObject({
  ...scope,
  ...interval,
  siteContractorId: id,
  zoneId: id,
});
const workerSchema = z.strictObject({
  ...scope,
  ...interval,
  workerAssignmentId: id,
  contractorZonePermissionId: id,
});
const revokeSchema = z.strictObject({ ...scope, permissionId: id });
const resultSchema = z.strictObject({
  id,
  siteId: id,
  contractorId: id,
  siteContractorId: id,
  zoneId: id,
  workerAssignmentId: id.nullable(),
  contractorZonePermissionId: id.nullable(),
  validFrom: instant,
  validUntil: instant,
  grantedBy: id,
  revokedAt: instant.nullable(),
  createdAt: instant,
});
type Command =
  z.infer<typeof contractorSchema> | z.infer<typeof workerSchema> | z.infer<typeof revokeSchema>;
type ContractorWork = Omit<z.infer<typeof contractorSchema>, 'commandId'>;
type WorkerWork = Omit<z.infer<typeof workerSchema>, 'commandId'>;
type RevokeWork = Omit<z.infer<typeof revokeSchema>, 'commandId'>;
type WorkCommand = ContractorWork | WorkerWork | RevokeWork;
type Kind = 'contractor' | 'worker';
export interface MainZonePermissionCommandResult {
  commandId: string;
  replayed: boolean;
  permission: z.infer<typeof resultSchema>;
}
interface Bounds {
  valid_from: string;
  valid_until: string | null;
}
interface Participation extends Bounds {
  id: string;
  contractor_id: string;
  is_active: boolean;
}
interface Assignment extends Bounds {
  id: string;
  worker_id: string;
  site_contractor_id: string | null;
  status: string;
}
interface ContractorPermission extends Bounds {
  id: string;
  revoked_at: Date | null;
}

function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}
function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Zone permission command could not be confirmed; retry with the same command ID',
  });
}

/** Retained-main permission core. Public bearer routes and internal idempotent receipts share rules. */
@Injectable()
export class MainZonePermissionCommandService {
  constructor(private readonly source: DataSource) {}

  async publicGrantContractor(
    siteId: string,
    input: GrantContractorZoneCommand,
    context: MainConfigurationCommandContext,
  ) {
    const p = command(GrantContractorZoneCommand, input);
    const value: ContractorWork = {
      ...p,
      requestId: p.requestId.toLowerCase(),
      siteContractorId: p.siteContractorId.toLowerCase(),
      zoneId: p.zoneId.toLowerCase(),
      ...this.publicScope(siteId, context),
    };
    return this.executePublic('contractor', value, context);
  }
  async publicGrantWorker(
    siteId: string,
    input: GrantWorkerZoneCommand,
    context: MainConfigurationCommandContext,
  ) {
    const p = command(GrantWorkerZoneCommand, input);
    const value: WorkerWork = {
      ...p,
      requestId: p.requestId.toLowerCase(),
      workerAssignmentId: p.workerAssignmentId.toLowerCase(),
      contractorZonePermissionId: p.contractorZonePermissionId.toLowerCase(),
      ...this.publicScope(siteId, context),
    };
    return this.executePublic('worker', value, context);
  }
  async publicRevoke(
    siteId: string,
    permissionId: string,
    kind: Kind,
    context: MainConfigurationCommandContext,
  ) {
    const value: RevokeWork = {
      permissionId: uuid(permissionId).toLowerCase(),
      ...this.publicScope(siteId, context),
    };
    await this.executePublic(kind, value, context);
    return { id: value.permissionId };
  }
  private publicScope(siteId: string, context: MainConfigurationCommandContext) {
    return {
      siteId: uuid(siteId).toLowerCase(),
      actorUserId: uuid(context.actorUserId).toLowerCase(),
    };
  }
  private async executePublic(
    kind: Kind,
    value: WorkCommand,
    context: MainConfigurationCommandContext,
  ) {
    const action = 'permissionId' in value ? 'REVOKE' : 'GRANT';
    const operation =
      kind === 'contractor'
        ? action === 'GRANT'
          ? 'CONTRACTOR_ZONE_GRANT'
          : 'CONTRACTOR_ZONE_REVOKE'
        : action === 'GRANT'
          ? 'WORKER_ZONE_GRANT'
          : 'WORKER_ZONE_REVOKE';
    return executeMainConfigurationCommand(
      this.source,
      context,
      operation,
      value,
      async (manager) => {
        const admin = await this.authorize(manager, value, kind, true);
        const sourceId =
          'permissionId' in value
            ? await this.revoke(manager, value, kind, admin)
            : 'siteContractorId' in value
              ? await this.createContractor(manager, value)
              : await this.createWorker(manager, value, admin);
        if (action === 'REVOKE') return { id: sourceId };
        // Match main's entity response and Date precision, independent of journal functions.
        const common =
          'p.id,p.valid_from AS "validFrom",p.valid_until AS "validUntil",p.granted_by AS "grantedBy",p.revoked_at AS "revokedAt",p.created_at AS "createdAt"';
        const rows =
          kind === 'contractor'
            ? await manager.query(
                `SELECT ${common},p.site_contractor_id AS "siteContractorId",p.zone_id AS "zoneId" FROM contractor_zone_permission p WHERE p.id=$1`,
                [sourceId],
              )
            : await manager.query(
                `SELECT ${common},p.worker_assignment_id AS "workerAssignmentId",p.contractor_zone_permission_id AS "contractorZonePermissionId" FROM worker_zone_permission p WHERE p.id=$1`,
                [sourceId],
              );
        if (!rows.length) missing();
        return rows[0] as { id: string; [key: string]: unknown };
      },
      async (manager) => {
        await this.authorize(manager, value, kind, true);
      },
    ).catch((error: unknown) => {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        conflict('Request or permission interval was already used');
      throw error;
    });
  }

  async grantContractor(input: unknown): Promise<MainZonePermissionCommandResult> {
    const parsed = contractorSchema.safeParse(input);
    if (!parsed.success) invalid();
    return this.execute('contractor', 'GRANT', parsed.data);
  }
  async grantWorker(input: unknown): Promise<MainZonePermissionCommandResult> {
    const parsed = workerSchema.safeParse(input);
    if (!parsed.success) invalid();
    return this.execute('worker', 'GRANT', parsed.data);
  }
  async revokeContractor(input: unknown): Promise<MainZonePermissionCommandResult> {
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) invalid();
    return this.execute('contractor', 'REVOKE', parsed.data);
  }
  async revokeWorker(input: unknown): Promise<MainZonePermissionCommandResult> {
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) invalid();
    return this.execute('worker', 'REVOKE', parsed.data);
  }

  private async authorize(
    manager: EntityManager,
    value: WorkCommand,
    kind: Kind,
    publicRoute = false,
  ): Promise<boolean> {
    const users = await manager.query(
      'SELECT id FROM app_user WHERE id=$1 AND is_active AND NOT must_change_password FOR SHARE',
      [value.actorUserId],
    );
    const roles: { role: string; site_id: string | null }[] = await manager.query(
      "SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 AND ((role='ADMIN' AND site_id IS NULL AND $4) OR (role=$2 AND site_id=$3)) FOR SHARE",
      [
        value.actorUserId,
        kind === 'contractor' ? 'SITE_MANAGER' : 'CONTRACTOR_REPRESENTATIVE',
        value.siteId,
        !publicRoute || kind !== 'contractor',
      ],
    );
    if (!users.length || !roles.length) forbidden();
    return roles.some((r) => r.role === 'ADMIN' && r.site_id === null);
  }
  private async representative(
    manager: EntityManager,
    value: WorkCommand,
    contractorId: string,
    admin: boolean,
  ): Promise<void> {
    if (admin) return;
    const grants = await manager.query(
      'SELECT id FROM contractor_representative_grant WHERE user_id=$1 AND contractor_id=$2 FOR SHARE',
      [value.actorUserId, contractorId],
    );
    if (!grants.length) conflict('Representative does not manage this contractor');
  }
  private async contained(
    manager: EntityManager,
    from: string,
    until: string,
    parent: Bounds,
  ): Promise<void> {
    const rows: { valid: boolean }[] = await manager.query(
      'SELECT isfinite($1::timestamptz) AND isfinite($2::timestamptz) AND isfinite($3::timestamptz) AND ($4::timestamptz IS NULL OR isfinite($4::timestamptz)) AND $2::timestamptz>$1::timestamptz AND $1::timestamptz>=$3::timestamptz AND ($4::timestamptz IS NULL OR $2::timestamptz<=$4::timestamptz) AS valid',
      [from, until, parent.valid_from, parent.valid_until],
    );
    if (!rows[0]?.valid)
      conflict(
        'Zone permission must fit its participation, assignment and Contractor permission intervals',
      );
  }

  private async execute(
    kind: Kind,
    action: 'GRANT' | 'REVOKE',
    value: Command,
  ): Promise<MainZonePermissionCommandResult> {
    const operation = `MAIN_${kind.toUpperCase()}_ZONE_${action}`;
    const { commandId, ...request } = value;
    const hash = computeCanonicalPayloadHash({ operation, ...request });
    const result = await withZoneAuthorityTransaction(this.source, async (manager) => {
      const admin = await this.authorize(manager, value, kind);
      const context = await manager.query(
        "SELECT current_setting('smartsite.mf06_command_id',true) AS value",
      );
      if (context[0]?.value) conflict('Nested authority commands are not supported');
      const inserted = await manager.query(
        'INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(command_id) DO NOTHING RETURNING command_id',
        [commandId, value.actorUserId, operation, hash],
      );
      if (!inserted.length) {
        const previous = await manager.query(
          'SELECT request_hash,operation,actor_user_id FROM mf06_authority_command WHERE command_id=$1',
          [commandId],
        );
        if (
          previous[0]?.request_hash !== hash ||
          previous[0]?.operation !== operation ||
          previous[0]?.actor_user_id !== value.actorUserId
        )
          conflict('Command ID was already used for another request');
        const permission = await this.result(manager, commandId, kind);
        if (permission.siteId !== value.siteId) unavailable();
        if (kind === 'worker')
          await this.representative(manager, value, permission.contractorId, admin);
        return { commandId, replayed: true, permission };
      }
      await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
      const sourceId =
        'permissionId' in value
          ? await this.revoke(manager, value, kind, admin)
          : 'siteContractorId' in value
            ? await this.createContractor(manager, value)
            : await this.createWorker(manager, value, admin);
      await manager.query(
        "INSERT INTO mf06_zone_permission_command_result(command_id,source_id,kind,result_json,result_hash) VALUES($1,$2,$3::text,mf06_zone_permission_response($2,$3::text),'')",
        [commandId, sourceId, kind],
      );
      const permission = await this.result(manager, commandId, kind);
      await manager.query("SELECT set_config('smartsite.mf06_command_id','',true)");
      return { commandId, replayed: false, permission };
    }).catch((error: unknown) => {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code === '42P01' || code === '42703' || code === '42883') unavailable();
      if (code === '23505') conflict('Request or permission interval was already used');
      throw error;
    });
    // Postcommit upper bound only. Existing witness must not be recertified after transaction aging.
    try {
      await this.source.query(
        'INSERT INTO mf06_authority_commit_witness(command_id,transaction_id) SELECT command_id,transaction_id FROM mf06_authority_command c WHERE command_id=$1 AND NOT EXISTS(SELECT 1 FROM mf06_authority_commit_witness w WHERE w.command_id=c.command_id) ON CONFLICT(command_id) DO NOTHING',
        [commandId],
      );
    } catch {
      unavailable();
    }
    return result;
  }

  private async createContractor(manager: EntityManager, value: ContractorWork): Promise<string> {
    const rows: Participation[] = await manager.query(
      'SELECT id,contractor_id,is_active,valid_from::text,valid_until::text FROM contractor_site_participation WHERE id=$1 AND site_id=$2 AND is_active FOR UPDATE',
      [value.siteContractorId, value.siteId],
    );
    const zones = await manager.query('SELECT id FROM zone WHERE id=$1 AND site_id=$2 FOR SHARE', [
      value.zoneId,
      value.siteId,
    ]);
    if (!rows.length || !zones.length) missing();
    await this.contained(manager, value.validFrom, value.validUntil, rows[0]!);
    const existing = await manager.query(
      'SELECT id,site_contractor_id=$2::uuid AND zone_id=$3::uuid AND valid_from=$4::timestamptz AND valid_until=$5::timestamptz AND granted_by=$6::uuid AS matches FROM contractor_zone_permission WHERE id=$1 FOR UPDATE',
      [
        value.requestId,
        value.siteContractorId,
        value.zoneId,
        value.validFrom,
        value.validUntil,
        value.actorUserId,
      ],
    );
    if (existing.length) {
      if (!existing[0].matches) conflict('Request was used for another permission');
      return value.requestId;
    }
    await manager.query(
      'INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4,$5,$6)',
      [
        value.requestId,
        value.siteContractorId,
        value.zoneId,
        value.validFrom,
        value.validUntil,
        value.actorUserId,
      ],
    );
    await this.audit(
      manager,
      value,
      'CONTRACTOR_ZONE_GRANTED',
      'contractor_zone_permission',
      value.requestId,
      {
        siteContractorId: value.siteContractorId,
        zoneId: value.zoneId,
        validFrom: value.validFrom,
        validUntil: value.validUntil,
      },
    );
    return value.requestId;
  }
  private async createWorker(
    manager: EntityManager,
    value: WorkerWork,
    admin: boolean,
  ): Promise<string> {
    const assignments: Assignment[] = await manager.query(
      'SELECT id,worker_id,site_contractor_id,status,valid_from::text,valid_until::text FROM worker_site_zone_assignment WHERE id=$1 AND site_id=$2 FOR UPDATE',
      [value.workerAssignmentId, value.siteId],
    );
    const assignment = assignments[0];
    if (
      !assignment?.site_contractor_id ||
      assignment.status !== 'APPROVED' ||
      !assignment.valid_until
    )
      conflict('An approved worker assignment with an expiry is required');
    const permissions: ContractorPermission[] = await manager.query(
      'SELECT id,revoked_at,valid_from::text,valid_until::text FROM contractor_zone_permission WHERE id=$1 AND site_contractor_id=$2 FOR UPDATE',
      [value.contractorZonePermissionId, assignment.site_contractor_id],
    );
    const participations: Participation[] = await manager.query(
      'SELECT id,contractor_id,is_active,valid_from::text,valid_until::text FROM contractor_site_participation WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE',
      [assignment.site_contractor_id, value.siteId],
    );
    const workers: { contractor_id: string | null }[] = await manager.query(
      'SELECT contractor_id FROM worker WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE',
      [assignment.worker_id, value.siteId],
    );
    const permission = permissions[0],
      participation = participations[0];
    if (
      !permission ||
      permission.revoked_at ||
      !participation ||
      !workers.length ||
      workers[0]!.contractor_id !== participation.contractor_id
    )
      conflict('Worker and Contractor Zone scopes do not match');
    await this.representative(manager, value, participation.contractor_id, admin);
    for (const parent of [assignment, permission, participation])
      await this.contained(manager, value.validFrom, value.validUntil, parent);
    const existing = await manager.query(
      'SELECT id,worker_assignment_id=$2::uuid AND contractor_zone_permission_id=$3::uuid AND valid_from=$4::timestamptz AND valid_until=$5::timestamptz AND granted_by=$6::uuid AS matches FROM worker_zone_permission WHERE id=$1 FOR UPDATE',
      [
        value.requestId,
        value.workerAssignmentId,
        value.contractorZonePermissionId,
        value.validFrom,
        value.validUntil,
        value.actorUserId,
      ],
    );
    if (existing.length) {
      if (!existing[0].matches) conflict('Request was used for another permission');
      return value.requestId;
    }
    await manager.query(
      'INSERT INTO worker_zone_permission(id,worker_assignment_id,contractor_zone_permission_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4,$5,$6)',
      [
        value.requestId,
        value.workerAssignmentId,
        value.contractorZonePermissionId,
        value.validFrom,
        value.validUntil,
        value.actorUserId,
      ],
    );
    await this.audit(
      manager,
      value,
      'WORKER_ZONE_GRANTED',
      'worker_zone_permission',
      value.requestId,
      {
        workerAssignmentId: value.workerAssignmentId,
        contractorZonePermissionId: value.contractorZonePermissionId,
        validFrom: value.validFrom,
        validUntil: value.validUntil,
      },
    );
    return value.requestId;
  }
  private async revoke(
    manager: EntityManager,
    value: RevokeWork,
    kind: Kind,
    admin: boolean,
  ): Promise<string> {
    const table = kind === 'contractor' ? 'contractor_zone_permission' : 'worker_zone_permission';
    const rows: { revoked_at: Date | null }[] = await manager.query(
      `SELECT revoked_at FROM ${table} WHERE id=$1 FOR UPDATE`,
      [value.permissionId],
    );
    if (!rows.length) missing();
    const scoped: { site_id: string; contractor_id: string }[] =
      kind === 'contractor'
        ? await manager.query(
            'SELECT s.site_id,s.contractor_id FROM contractor_zone_permission p JOIN contractor_site_participation s ON s.id=p.site_contractor_id WHERE p.id=$1',
            [value.permissionId],
          )
        : await manager.query(
            'SELECT a.site_id,s.contractor_id FROM worker_zone_permission p JOIN worker_site_zone_assignment a ON a.id=p.worker_assignment_id JOIN contractor_site_participation s ON s.id=a.site_contractor_id AND s.site_id=a.site_id WHERE p.id=$1',
            [value.permissionId],
          );
    if (!scoped.length || scoped[0]!.site_id !== value.siteId) missing();
    // Revocation remains possible after assignment/participation expiry or deactivation.
    if (kind === 'worker')
      await this.representative(manager, value, scoped[0]!.contractor_id, admin);
    if (!rows[0]!.revoked_at) {
      await manager.query(`UPDATE ${table} SET revoked_at=clock_timestamp() WHERE id=$1`, [
        value.permissionId,
      ]);
      await this.audit(manager, value, 'ZONE_PERMISSION_REVOKED', table, value.permissionId, {});
    }
    return value.permissionId;
  }
  private async audit(
    manager: EntityManager,
    value: WorkCommand,
    action: string,
    table: string,
    permissionId: string,
    changes: object,
  ): Promise<void> {
    const sites = await manager.query(
      'UPDATE site SET access_policy_version=access_policy_version+1 WHERE id=$1 RETURNING id',
      [value.siteId],
    );
    if (!sites.length) missing();
    await manager.query(
      'INSERT INTO audit_log(id,actor_account_id,site_id,action,entity_type,entity_id,reason,changes,occurred_at) VALUES($1,$2,$3,$4,$5,$6,NULL,$7,clock_timestamp())',
      [randomUUID(), value.actorUserId, value.siteId, action, table, permissionId, changes],
    );
  }
  private async result(
    manager: EntityManager,
    commandId: string,
    kind: Kind,
  ): Promise<MainZonePermissionCommandResult['permission']> {
    const rows = await manager.query(
      "SELECT kind,result_json,result_hash=encode(sha256(convert_to(result_json::text,'UTF8')),'hex') AS hash_valid FROM mf06_zone_permission_command_result WHERE command_id=$1",
      [commandId],
    );
    const parsed = resultSchema.safeParse(rows[0]?.result_json);
    if (!parsed.success || !rows[0]?.hash_valid || rows[0]?.kind !== kind) unavailable();
    if (
      kind === 'contractor'
        ? parsed.data.workerAssignmentId !== null || parsed.data.contractorZonePermissionId !== null
        : !parsed.data.workerAssignmentId || !parsed.data.contractorZonePermissionId
    )
      unavailable();
    return parsed.data;
  }
}
