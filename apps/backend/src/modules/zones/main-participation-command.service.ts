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
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CreateContractorParticipationCommand } from '../workforce/directory/contractor-operations.service.js';
import { withZoneAuthorityTransaction } from './zone-authority-transaction.js';

const id = z.uuid().transform((value) => value.toLowerCase());
const instant = z.iso.datetime({ offset: true }).max(128);
const commandSchema = z.strictObject({
  commandId: id,
  actorUserId: id,
  siteId: id,
  contractorId: id,
  validFrom: instant,
  validUntil: instant.nullable(),
});
const participationSchema = z.strictObject({
  id,
  siteId: id,
  contractorId: id,
  isActive: z.boolean(),
  validFrom: instant,
  validUntil: instant.nullable(),
  createdAt: instant,
});
type Command = z.infer<typeof commandSchema>;
export interface MainParticipationCommandResult {
  commandId: string;
  replayed: boolean;
  participation: z.infer<typeof participationSchema>;
}
function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}
function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Participation command could not be confirmed; retry with the same command ID',
  });
}

/** Retained-main create core; no invented participation revoke/status API. */
@Injectable()
export class MainParticipationCommandService {
  constructor(private readonly source: DataSource) {}
  async publicCreate(
    contractorId: string,
    input: CreateContractorParticipationCommand,
    context: MainConfigurationCommandContext,
  ) {
    const p = command(CreateContractorParticipationCommand, input);
    const value = {
      contractorId: uuid(contractorId).toLowerCase(),
      siteId: p.siteId.toLowerCase(),
      validFrom: this.publicInstant(p.validFrom),
      validUntil: p.validUntil === null ? null : this.publicInstant(p.validUntil),
    };
    return executeMainConfigurationCommand(
      this.source,
      context,
      'MAIN_PARTICIPATION_CREATE',
      value,
      async (manager) => {
        const sourceId = await this.createSource(manager, value);
        const rows = await manager.query(
          'SELECT id,contractor_id AS "contractorId",site_id AS "siteId",valid_from AS "validFrom",valid_until AS "validUntil",is_active AS "isActive",created_at AS "createdAt" FROM contractor_site_participation WHERE id=$1',
          [sourceId],
        );
        return rows[0] as {
          id: string;
          contractorId: string;
          siteId: string;
          validFrom: Date;
          validUntil: Date | null;
          isActive: boolean;
          createdAt: Date;
        };
      },
    );
  }
  private publicInstant(value: string): string {
    // Retain main public Date interpretation for local/date-only inputs. Explicit
    // offsets retain PostgreSQL precision; the existing JSON response uses Date.
    if (!Number.isFinite(new Date(value).getTime())) invalid('Invalid participation time');
    return /[Tt ].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(value) ? value : new Date(value).toISOString();
  }
  async create(input: unknown): Promise<MainParticipationCommandResult> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) invalid();
    const value = parsed.data,
      { commandId, ...body } = value,
      requestHash = computeCanonicalPayloadHash({
        operation: 'MAIN_PARTICIPATION_CREATE',
        ...body,
      });
    const result = await withZoneAuthorityTransaction(this.source, async (manager) => {
      await this.authorize(manager, value.actorUserId);
      const context = await manager.query(
        "SELECT current_setting('smartsite.mf06_command_id',true) AS value",
      );
      if (context[0]?.value) conflict('Nested authority commands are not supported');
      const inserted = await manager.query(
        "INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'MAIN_PARTICIPATION_CREATE',$3) ON CONFLICT(command_id) DO NOTHING RETURNING command_id",
        [commandId, value.actorUserId, requestHash],
      );
      if (!inserted.length) {
        const previous = await manager.query(
          'SELECT actor_user_id,operation,request_hash FROM mf06_authority_command WHERE command_id=$1',
          [commandId],
        );
        if (
          previous[0]?.actor_user_id !== value.actorUserId ||
          previous[0]?.operation !== 'MAIN_PARTICIPATION_CREATE' ||
          previous[0]?.request_hash !== requestHash
        )
          conflict('Command ID was already used for another request');
        const participation = await this.result(manager, value);
        return { commandId, replayed: true, participation };
      }
      await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
      const sourceId = await this.createSource(manager, value);
      await manager.query(
        "INSERT INTO mf06_participation_command_result(command_id,source_id,result_json,result_hash) VALUES($1,$2,mf06_participation_response($2),'')",
        [commandId, sourceId],
      );
      const participation = await this.result(manager, value);
      await manager.query("SELECT set_config('smartsite.mf06_command_id','',true)");
      return { commandId, replayed: false, participation };
    }).catch((error: unknown) => {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code === '42P01' || code === '42703' || code === '42883') unavailable();
      throw error;
    });
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
  private async createSource(
    manager: EntityManager,
    value: Pick<Command, 'siteId' | 'contractorId' | 'validFrom' | 'validUntil'>,
  ): Promise<string> {
    const range = await manager.query(
      'SELECT isfinite($1::timestamptz) AND ($2::timestamptz IS NULL OR (isfinite($2::timestamptz) AND $2::timestamptz>$1::timestamptz)) AS valid',
      [value.validFrom, value.validUntil],
    );
    if (!range[0]?.valid) invalid('validUntil must be after validFrom');
    // Main requires existence; inactive Contractors and overlapping/open-ended
    // participation remain permitted. No invented business audit or Site policy bump.
    if (
      !(
        await manager.query('SELECT id FROM contractor WHERE id=$1 FOR SHARE', [value.contractorId])
      ).length
    )
      missing();
    if (!(await manager.query('SELECT id FROM site WHERE id=$1 FOR SHARE', [value.siteId])).length)
      missing();
    const sourceId = randomUUID();
    await manager.query(
      'INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,$4,$5,true)',
      [sourceId, value.contractorId, value.siteId, value.validFrom, value.validUntil],
    );
    return sourceId;
  }
  private async authorize(manager: EntityManager, actorUserId: string): Promise<void> {
    if (
      !(
        await manager.query(
          'SELECT id FROM app_user WHERE id=$1 AND is_active AND NOT must_change_password FOR SHARE',
          [actorUserId],
        )
      ).length
    )
      forbidden();
    if (
      !(
        await manager.query(
          "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='ADMIN' AND site_id IS NULL FOR SHARE",
          [actorUserId],
        )
      ).length
    )
      forbidden();
  }
  private async result(
    manager: EntityManager,
    value: Command,
  ): Promise<MainParticipationCommandResult['participation']> {
    const rows = await manager.query(
      "SELECT source_id,result_json,result_hash=encode(sha256(convert_to(result_json::text,'UTF8')),'hex') AS hash_valid FROM mf06_participation_command_result WHERE command_id=$1",
      [value.commandId],
    );
    const parsed = participationSchema.safeParse(rows[0]?.result_json);
    if (
      !parsed.success ||
      !rows[0]?.hash_valid ||
      parsed.data.id !== rows[0]?.source_id ||
      parsed.data.siteId !== value.siteId ||
      parsed.data.contractorId !== value.contractorId
    )
      unavailable();
    return parsed.data;
  }
}
