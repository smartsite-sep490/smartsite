import { randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { z } from 'zod';
import { conflict, invalid, missing } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { withZoneAuthorityTransaction } from './zone-authority-transaction.js';

const id = z.uuid().transform((v) => v.toLowerCase());
const instant = z.iso.datetime({ offset: true }).max(128);
const scope = { commandId: id, actorUserId: id, siteId: id, zoneId: id };
const createSchema = z.strictObject({
  ...scope,
  workerId: id,
  effect: z.enum(['ALLOW', 'DENY']),
  validFrom: instant,
  validUntil: instant.nullish().transform((value) => value ?? null),
});
const revokeSchema = z.strictObject({ ...scope, grantId: id });
const grantSchema = z.strictObject({
  id,
  siteId: id,
  zoneId: id,
  workerId: id,
  effect: z.enum(['ALLOW', 'DENY']),
  validFrom: instant,
  validUntil: instant.nullable(),
  revokedAt: instant.nullable(),
  createdAt: instant,
});
type Command = z.infer<typeof createSchema> | z.infer<typeof revokeSchema>;
export interface MainZoneDenyCommandResult {
  commandId: string;
  replayed: boolean;
  grant: z.infer<typeof grantSchema>;
}

function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Zone command could not be confirmed; retry with the same command ID',
  });
}

/** Retained-main candidate, not registered or routed. No ALLOW grants, history readiness or new role. */
@Injectable()
export class MainZoneDenyCommandService {
  constructor(private readonly source: DataSource) {}

  async create(input: unknown): Promise<MainZoneDenyCommandResult> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) invalid();
    return this.execute('MAIN_ZONE_DENY_CREATE', parsed.data);
  }

  async revoke(input: unknown): Promise<MainZoneDenyCommandResult> {
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) invalid();
    return this.execute('MAIN_ZONE_DENY_REVOKE', parsed.data);
  }

  private async authorize(manager: EntityManager, actor: string): Promise<void> {
    const users: { id: string }[] = await manager.query(
      'SELECT id FROM app_user WHERE id=$1 AND is_active AND NOT must_change_password FOR SHARE',
      [actor],
    );
    const roles: { id: string }[] = await manager.query(
      "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='ADMIN' AND site_id IS NULL FOR SHARE",
      [actor],
    );
    if (!users.length || !roles.length)
      throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
  }

  private async execute(
    operation: 'MAIN_ZONE_DENY_CREATE' | 'MAIN_ZONE_DENY_REVOKE',
    value: Command,
  ): Promise<MainZoneDenyCommandResult> {
    const { commandId, ...request } = value;
    const requestHash = computeCanonicalPayloadHash({ operation, ...request });
    const result = await withZoneAuthorityTransaction(this.source, async (manager) => {
      await this.authorize(manager, value.actorUserId);
      const context: { value: string | null }[] = await manager.query(
        "SELECT current_setting('smartsite.mf06_command_id',true) AS value",
      );
      if (context[0]?.value) conflict('Nested authority commands are not supported');
      const inserted: { command_id: string }[] = await manager.query(
        'INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(command_id) DO NOTHING RETURNING command_id',
        [commandId, value.actorUserId, operation, requestHash],
      );
      if (!inserted.length) {
        const previous: { request_hash: string; operation: string; actor_user_id: string }[] =
          await manager.query(
            'SELECT request_hash,operation,actor_user_id FROM mf06_authority_command WHERE command_id=$1',
            [commandId],
          );
        if (
          !previous.length ||
          previous[0]!.request_hash !== requestHash ||
          previous[0]!.operation !== operation ||
          previous[0]!.actor_user_id !== value.actorUserId
        )
          conflict('Command ID was already used for another request');
        return { commandId, replayed: true, grant: await this.result(manager, commandId) };
      }
      await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
      let sourceId: string;
      if ('workerId' in value) {
        const zone: { id: string }[] = await manager.query(
          'SELECT id FROM zone WHERE id=$1 AND site_id=$2 FOR SHARE',
          [value.zoneId, value.siteId],
        );
        const worker: { id: string }[] = await manager.query(
          'SELECT id FROM worker WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE',
          [value.workerId, value.siteId],
        );
        if (!zone.length || !worker.length) missing();
        const interval: { valid: boolean }[] = await manager.query(
          'SELECT isfinite($1::timestamptz) AND ($2::timestamptz IS NULL OR (isfinite($2::timestamptz) AND $2::timestamptz>$1::timestamptz)) AS valid',
          [value.validFrom, value.validUntil],
        );
        if (!interval[0]?.valid) invalid('validUntil must be later than validFrom');
        if (value.effect === 'ALLOW')
          conflict('Use Contractor and Worker Zone permissions within approved assignment bounds');
        sourceId = randomUUID();
        await manager.query(
          "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until) VALUES($1,$2,$3,$4,'DENY',$5,$6)",
          [sourceId, value.siteId, value.zoneId, value.workerId, value.validFrom, value.validUntil],
        );
      } else {
        const grant: { id: string }[] = await manager.query(
          'SELECT id FROM zone_access_grant WHERE id=$1 AND site_id=$2 AND zone_id=$3 FOR UPDATE',
          [value.grantId, value.siteId, value.zoneId],
        );
        if (!grant.length) missing();
        sourceId = grant[0]!.id;
        // Retain first revoke, including legacy flat-ALLOW rows which must remain revocable.
        await manager.query(
          'UPDATE zone_access_grant SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL',
          [sourceId],
        );
      }
      await manager.query(
        "INSERT INTO mf06_zone_deny_command_result(command_id,source_id,result_json,result_hash) VALUES($1,$2,mf06_zone_deny_response($2),'')",
        [commandId, sourceId],
      );
      const grant = await this.result(manager, commandId);
      await manager.query("SELECT set_config('smartsite.mf06_command_id','',true)");
      return { commandId, replayed: false, grant };
    }).catch((error: unknown) => {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code === '42P01' || code === '42703' || code === '42883') unavailable();
      throw error;
    });
    // Separate connection after COMMIT. Witness time is an upper bound, never a commit timestamp.
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

  private async result(
    manager: EntityManager,
    commandId: string,
  ): Promise<MainZoneDenyCommandResult['grant']> {
    const rows: { result_json: unknown; hash_valid: boolean }[] = await manager.query(
      "SELECT result_json,result_hash=encode(sha256(convert_to(result_json::text,'UTF8')),'hex') AS hash_valid FROM mf06_zone_deny_command_result WHERE command_id=$1",
      [commandId],
    );
    const parsed = grantSchema.safeParse(rows[0]?.result_json);
    if (!parsed.success || !rows[0]?.hash_valid) unavailable();
    return parsed.data;
  }
}
