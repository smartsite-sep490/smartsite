import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';
import { conflict, uuid } from '../../common/configuration/commands.js';
import { executeMainConfigurationCommand } from '../../common/configuration/main-configuration-authority.js';
import { hasMainAuthorityCapture } from '../../common/configuration/main-authority-capture-preflight.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { configurationCommandContext } from '../auth/configuration-command-context.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import type { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  verifyMainAuthorityCutoverRelease,
  type MainAuthorityCutoverReleaseConfig,
} from './main-authority-cutover-release.js';

/** Internal controlled operation. No route, provider registration or startup activation. */
export class MainAuthorityCutoverService {
  private readonly release: MainAuthorityCutoverReleaseConfig;
  private readonly environment: BackendEnvironment['NODE_ENV'];
  constructor(
    private readonly source: DataSource,
    private readonly auth: UserAuthGuard,
    release: MainAuthorityCutoverReleaseConfig,
    runtime: ConfigService<BackendEnvironment, true>,
  ) {
    this.release = Object.freeze({ ...release });
    this.environment = runtime.get('NODE_ENV', { infer: true });
  }

  async activate(request: AuthenticatedRequest, expectedPreviousEpochId: string | null) {
    if (!request.user) throw new UnauthorizedException();
    const context = configurationCommandContext(request, this.auth);
    const expected =
      expectedPreviousEpochId === null ? null : uuid(expectedPreviousEpochId).toLowerCase();
    // Filesystem work precedes all DB locks/retries. Trusted release bytes must be immutable during activation.
    const release = await verifyMainAuthorityCutoverRelease(this.release, this.environment).catch(
      () => unavailable(),
    );
    const epochId = randomUUID();
    const committed = await executeMainConfigurationCommand(
      this.source,
      context,
      'MAIN_AUTHORITY_BASELINE',
      {
        epochId,
        expectedPreviousEpochId: expected,
        declaredWriterManifestHash: release.manifestSha256,
        releaseCommit: release.releaseCommit,
      },
      async (manager) => {
        const [installed]: { present: boolean }[] = await manager.query(
          "SELECT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='mf06_authority_control_guard') AS present",
        );
        if (!installed?.present || !(await hasMainAuthorityCapture(manager))) unavailable();
        const [registry]: { hash: string }[] = await manager.query(
          `SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind COLLATE "C")::text,'UTF8')),'hex') AS hash FROM authorization_history_source s`,
        );
        if (registry?.hash !== release.sourceRegistryHash) unavailable();
        const [current]: { epoch_id: string | null }[] = await manager.query(
          'SELECT epoch_id FROM authorization_history_control WHERE singleton=1 FOR UPDATE',
        );
        if (!current || current.epoch_id !== expected) conflict('Authority control epoch changed');
        await manager.query(
          'INSERT INTO authorization_history_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)',
          [epochId, release.manifestSha256],
        );
        await manager.query(
          "INSERT INTO authorization_history_baseline(epoch_id,command_id) VALUES($1,current_setting('smartsite.mf06_command_id')::uuid)",
          [epochId],
        );
        const updated: { epoch_id: string }[] = await manager.query(
          'WITH updated AS (UPDATE authorization_history_control SET epoch_id=$1 WHERE singleton=1 AND epoch_id IS NOT DISTINCT FROM $2 RETURNING epoch_id) SELECT epoch_id FROM updated',
          [epochId, expected],
        );
        if (updated.length !== 1 || updated[0]?.epoch_id !== epochId)
          conflict('Authority control epoch changed');
        const [baseline]: { command_id: string; snapshot_hash: string; captured_at: string }[] =
          await manager.query(
            `SELECT command_id,snapshot_hash,to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS captured_at FROM authorization_history_baseline WHERE epoch_id=$1`,
            [epochId],
          );
        if (!baseline) unavailable();
        return baseline;
      },
    ).catch((error: unknown) => {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code === '54000') {
        throw new PublicHttpException(413, {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Authority baseline resource limit exceeded',
        });
      }
      if (code && ['55000', '55P03', '57014', '42P01', '42703', '42883'].includes(code))
        unavailable();
      throw error;
    });
    // A denied readback or missing witness cannot undo the already committed cutover.
    return this.source.transaction(async (manager) => {
      await context.reauthorize!(manager);
      const allowed: { id: string }[] = await manager.query(
        `SELECT u.id FROM app_user u JOIN user_role_assignment a ON a.user_id=u.id
        WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password AND a.role='ADMIN' AND a.site_id IS NULL FOR SHARE OF u,a`,
        [context.actorUserId],
      );
      if (!allowed.length)
        throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
      const [receipt]: { witnessed: boolean }[] = await manager.query(
        `SELECT EXISTS(SELECT 1 FROM authorization_history_commit_receipt w JOIN authorization_history_command c USING(command_id)
        WHERE c.command_id=$1 AND c.transaction_id=w.transaction_id) AS witnessed`,
        [committed.command_id],
      );
      return {
        epochId,
        commandId: committed.command_id,
        capturedAt: committed.captured_at,
        snapshotHash: committed.snapshot_hash,
        manifestSha256: release.manifestSha256,
        provenance: release.provenance,
        commitStatus: 'COMMITTED' as const,
        witnessConfirmed: receipt?.witnessed === true,
      };
    });
  }
}

function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Reviewed authority cutover release is unavailable',
  });
}
