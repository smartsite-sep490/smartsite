import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { invalid, uuid } from '../../common/configuration/commands.js';

export interface MainAuthorityBaselineRecord {
  epochId: string;
  commandId: string;
  capturedAt: string;
  declaredWriterManifestHash: string;
  sourceRegistryHash: string;
  snapshotHash: string;
  rowCount: number;
  state: 'STAGING';
  protocol: 'MF06_MAIN_BASELINE_JSONB_V1';
  snapshot: Record<string, unknown>;
  witnessConfirmed: boolean;
}

/** Internal metadata capture only; no API, live worker, READY promotion or historical permission. */
export class MainAuthorityBaselineService {
  constructor(private readonly source: DataSource) {}

  async capture(
    context: MainConfigurationCommandContext,
    declaredWriterManifestHash: string,
  ): Promise<MainAuthorityBaselineRecord> {
    if (
      typeof declaredWriterManifestHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(declaredWriterManifestHash)
    )
      invalid('Invalid declared writer manifest hash');
    if (!context || typeof context.reauthorize !== 'function') throw new UnauthorizedException();
    const actorUserId = uuid(context.actorUserId).toLowerCase();
    const epochId = randomUUID();
    try {
      await executeMainConfigurationCommand(
        this.source,
        context,
        'MAIN_AUTHORITY_BASELINE',
        { epochId, declaredWriterManifestHash },
        async (manager) => {
          await manager.query(
            'INSERT INTO authorization_history_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)',
            [epochId, declaredWriterManifestHash],
          );
          await manager.query(
            `INSERT INTO authorization_history_baseline(epoch_id,command_id)
            VALUES($1,current_setting('smartsite.mf06_command_id')::uuid)`,
            [epochId],
          );
        },
      );
      // A denied late response does not retroactively undo the committed capture.
      // This internal result is private global metadata, never a public assessment DTO.
      return await this.source.transaction(async (manager) => {
        await context.reauthorize!(manager);
        const users = await manager.query(
          'SELECT id FROM app_user WHERE id=$1 AND is_active AND NOT must_change_password FOR SHARE',
          [actorUserId],
        );
        const roles = await manager.query(
          "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='ADMIN' AND site_id IS NULL FOR SHARE",
          [actorUserId],
        );
        if (!users.length || !roles.length)
          throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
        const rows: {
          epoch_id: string;
          command_id: string;
          captured_at: string;
          writer_manifest_hash: string;
          source_registry_hash: string;
          snapshot_hash: string;
          row_count: number;
          state: string;
          snapshot_text: string;
          witnessed: boolean;
        }[] = await manager.query(
          `SELECT b.epoch_id,b.command_id,
          to_char(b.captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS captured_at,
          e.writer_manifest_hash,b.source_registry_hash,b.snapshot_hash,b.row_count,e.state,
          b.snapshot_json::text AS snapshot_text,
          COALESCE(w.transaction_id=c.transaction_id,false) AS witnessed
          FROM authorization_history_baseline b JOIN authorization_history_epoch e USING(epoch_id)
          JOIN authorization_history_command c USING(command_id)
          LEFT JOIN authorization_history_commit_receipt w USING(command_id)
          WHERE b.epoch_id=$1 AND c.actor_user_id=$2 AND b.transaction_id=c.transaction_id`,
          [epochId, actorUserId],
        );
        const row = rows[0];
        if (!row || row.state !== 'STAGING') return unavailable();
        const snapshot = JSON.parse(row.snapshot_text) as Record<string, unknown>;
        // A JSON number outside JS precision must never return a mismatched hash/body.
        const exact: { value: boolean }[] = await manager.query(
          'SELECT snapshot_json=$1::jsonb AS value FROM authorization_history_baseline WHERE epoch_id=$2',
          [JSON.stringify(snapshot), epochId],
        );
        if (exact[0]?.value !== true) return unavailable();
        return {
          epochId: row.epoch_id,
          commandId: row.command_id,
          capturedAt: row.captured_at,
          declaredWriterManifestHash: row.writer_manifest_hash,
          sourceRegistryHash: row.source_registry_hash,
          snapshotHash: row.snapshot_hash,
          rowCount: row.row_count,
          state: 'STAGING',
          protocol: 'MF06_MAIN_BASELINE_JSONB_V1',
          snapshot,
          witnessConfirmed: row.witnessed,
        };
      });
    } catch (error) {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code === '54000')
        throw new PublicHttpException(413, {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Authority baseline resource limit exceeded',
        });
      if (code && ['55000', '55P03', '57014', '42P01', '42703', '42883'].includes(code))
        return unavailable();
      throw error;
    }
  }
}

function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Main authority baseline capture is unavailable',
  });
}
