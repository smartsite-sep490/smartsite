import { Injectable } from '@nestjs/common';
import type { AccessSetupResponse } from '@smartsite/contracts';
import { DataSource, QueryFailedError } from 'typeorm';
import { missing, uuid } from '../../common/configuration/commands.js';
import type { MainConfigurationCommandContext } from '../../common/configuration/main-configuration-authority.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';

function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}

type Dated<T extends { validFrom: string; validUntil: string | null }> = Omit<
  T,
  'validFrom' | 'validUntil'
> & { validFrom: Date; validUntil: Date | null };
type PermissionRow<T extends { validFrom: string; validUntil: string; revokedAt: string | null }> =
  Omit<T, 'validFrom' | 'validUntil' | 'revokedAt'> & {
    validFrom: Date;
    validUntil: Date;
    revokedAt: Date | null;
  };
const dates = <T extends { validFrom: Date; validUntil: Date | null }>(row: T) => ({
  ...row,
  validFrom: row.validFrom.toISOString(),
  validUntil: row.validUntil?.toISOString() ?? null,
});
const permissionDates = <T extends { validFrom: Date; validUntil: Date; revokedAt: Date | null }>(
  row: T,
) => ({
  ...row,
  validFrom: row.validFrom.toISOString(),
  validUntil: row.validUntil.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
});

/** Read retained-main options without loading branch-only entity columns or writing history. */
@Injectable()
export class SiteAccessSetupQueryService {
  constructor(private readonly source: DataSource) {}

  async options(
    siteId: string,
    context: MainConfigurationCommandContext,
  ): Promise<AccessSetupResponse> {
    const site = uuid(siteId).toLowerCase();
    const actor = uuid(context.actorUserId).toLowerCase();
    return this.source
      .transaction('REPEATABLE READ', async (manager) => {
        // The original bearer, active account and session are pinned until this read completes.
        await context.reauthorize?.(manager);
        const users = await manager.query(
          'SELECT id FROM app_user WHERE id=$1 AND is_active AND NOT must_change_password FOR SHARE',
          [actor],
        );
        if (!users.length) forbidden();
        const roles: { role: string; site_id: string | null }[] = await manager.query(
          "SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 AND ((role='ADMIN' AND site_id IS NULL) OR (site_id=$2 AND role IN ('SITE_MANAGER','CONTRACTOR_REPRESENTATIVE'))) FOR SHARE",
          [actor, site],
        );
        if (!roles.length) forbidden();
        if (!(await manager.query('SELECT id FROM site WHERE id=$1', [site])).length) missing();
        const admin = roles.some((r) => r.role === 'ADMIN' && r.site_id === null);
        const siteManager = admin || roles.some((r) => r.role === 'SITE_MANAGER');
        const grants: { contractor_id: string }[] = siteManager
          ? []
          : await manager.query(
              'SELECT contractor_id FROM contractor_representative_grant WHERE user_id=$1 FOR SHARE',
              [actor],
            );
        const participations: Dated<AccessSetupResponse['participations'][number]>[] =
          await manager.query(
            `SELECT p.id,p.contractor_id AS "contractorId",c.name,
          p.valid_from AS "validFrom",p.valid_until AS "validUntil"
         FROM contractor_site_participation p JOIN contractor c ON c.id=p.contractor_id
         WHERE p.site_id=$1 AND p.is_active AND ($2 OR p.contractor_id=ANY($3::uuid[])) ORDER BY p.id`,
            [site, siteManager, grants.map((g) => g.contractor_id)],
          );
        // Main options intentionally include inactive/expired rows and non-approved assignments.
        // These are configuration records, not an authorization decision at an event time.
        const workers: AccessSetupResponse['workers'] = await manager.query(
          `SELECT id,display_name AS name,contractor_id AS "contractorId" FROM worker
         WHERE site_id=$1 AND ($2 OR contractor_id=ANY($3::uuid[])) ORDER BY id`,
          [site, siteManager, participations.map((p) => p.contractorId)],
        );
        const assignments: Dated<AccessSetupResponse['assignments'][number]>[] =
          await manager.query(
            `SELECT a.id,a.worker_id AS "workerId",w.display_name AS "workerName",
          a.site_contractor_id AS "siteContractorId",a.status,a.valid_from AS "validFrom",
          a.valid_until AS "validUntil",a.version,a.review_note AS "reviewNote"
         FROM worker_site_zone_assignment a JOIN worker w ON w.id=a.worker_id
         WHERE a.site_id=$1 AND a.worker_id=ANY($2::uuid[]) ORDER BY a.id`,
            [site, workers.map((w) => w.id)],
          );
        const contractorPermissions: PermissionRow<
          AccessSetupResponse['contractorPermissions'][number]
        >[] = await manager.query(
          `SELECT id,site_contractor_id AS "siteContractorId",zone_id AS "zoneId",
          valid_from AS "validFrom",valid_until AS "validUntil",revoked_at AS "revokedAt"
         FROM contractor_zone_permission WHERE site_contractor_id=ANY($1::uuid[]) ORDER BY id`,
          [participations.map((p) => p.id)],
        );
        const workerPermissions: PermissionRow<AccessSetupResponse['workerPermissions'][number]>[] =
          await manager.query(
            `SELECT id,worker_assignment_id AS "workerAssignmentId",
          contractor_zone_permission_id AS "contractorZonePermissionId",
          valid_from AS "validFrom",valid_until AS "validUntil",revoked_at AS "revokedAt"
         FROM worker_zone_permission WHERE worker_assignment_id=ANY($1::uuid[]) ORDER BY id`,
            [assignments.map((a) => a.id)],
          );
        const zones: AccessSetupResponse['zones'] = await manager.query(
          'SELECT id,name FROM zone WHERE site_id=$1 ORDER BY id',
          [site],
        );
        // pg Dates serialize with the same millisecond precision as retained-main entity responses.
        return {
          canReviewAssignments: siteManager,
          canGrantContractorZones: roles.some((r) => r.role === 'SITE_MANAGER'),
          canGrantWorkerZones: admin || roles.some((r) => r.role === 'CONTRACTOR_REPRESENTATIVE'),
          participations: participations.map(dates),
          workers,
          zones,
          assignments: assignments.map(dates),
          contractorPermissions: contractorPermissions.map(permissionDates),
          workerPermissions: workerPermissions.map(permissionDates),
        };
      })
      .catch((error: unknown) => {
        if (error instanceof QueryFailedError && error.driverError?.code === '40001')
          throw new PublicHttpException(503, {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Access setup changed during the request; refresh to retry',
          });
        throw error;
      });
  }
}
