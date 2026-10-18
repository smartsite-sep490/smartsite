import { PRE_NAMING_AUTHORITY_RELATIONS } from './authority-storage-relations.js';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { conflict, uuid } from './commands.js';
import { PublicHttpException } from '../http/public-http-exception.js';
import { withZoneAuthorityTransaction } from '../../modules/zones/zone-authority-transaction.js';
import { MAIN_AUTHORITY_V2_SOURCES as MAIN_AUTHORITY_SOURCES } from './main-team-authority-sources.js';
import { hasMainAuthorityCapture } from './main-authority-capture-preflight.js';

/** Server-only actor claim; it is never accepted from a management DTO. */
export interface MainConfigurationCommandContext {
  actorUserId: string;
  reauthorize?: (manager: EntityManager) => Promise<void>;
}
type Operation =
  | 'MAIN_AUTHORITY_BASELINE'
  | 'USER_ACCOUNT_CREATE'
  | 'USER_SITE_REPRESENTATIVE_CREATE'
  | 'USER_CONTRACTOR_WORKER_ACCOUNT_CREATE'
  | 'USER_ACCOUNT_STATUS'
  | 'USER_ROLE_REPLACE'
  | 'USER_PASSWORD_RESET'
  | 'USER_PASSWORD_CHANGE'
  | 'SITE_CREATE'
  | 'ZONE_CREATE'
  | 'ZONE_POLICY_UPDATE'
  | 'ZONE_DENY_CREATE'
  | 'ZONE_DENY_REVOKE'
  | 'MAIN_PARTICIPATION_CREATE'
  | 'CONTRACTOR_CREATE'
  | 'SITE_CONTRACTOR_CREATE'
  | 'MAIN_REPRESENTATIVE_GRANT'
  | 'MAIN_REPRESENTATIVE_ASSIGN'
  | 'WORKER_ROSTER_CREATE'
  | 'WORKER_ACCOUNT_PREPARE'
  | 'WORKER_ACCOUNT_LINK'
  | 'WORKER_PROFILE_UPDATE'
  | 'CONTRACTOR_WORKER_CREATE'
  | 'ASSIGNMENT_REQUEST'
  | 'ASSIGNMENT_SAFETY_REVIEW'
  | 'ASSIGNMENT_DECISION'
  | 'ASSIGNMENT_REVOKE'
  | 'CONTRACTOR_ZONE_GRANT'
  | 'CONTRACTOR_ZONE_REVOKE'
  | 'WORKER_ZONE_GRANT'
  | 'WORKER_ZONE_REVOKE'
  | 'TEAM_CREATE'
  | 'TEAM_ARCHIVE'
  | 'TEAM_ASSIGN'
  | 'TEAM_ZONE_GRANT'
  | 'TEAM_ZONE_REVOKE'
  | 'CAMERA_CREATE'
  | 'CAMERA_STATUS_UPDATE'
  | 'REGION_CREATE'
  | 'REGION_POLYGON_UPDATE'
  | 'REGION_STATUS_UPDATE';
const relations = [
  'authorization_history_source',
  'authorization_history_command',
  'authorization_history_epoch',
  'authorization_history_control',
  'authorization_history_head',
  'authorization_history_revision',
  'authorization_history_gap',
  'authorization_history_commit_receipt',
];
function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Configuration authority journal is unavailable',
  });
}

async function assertConfigurationActor(
  manager: EntityManager,
  context: MainConfigurationCommandContext,
  actorUserId: string,
  allowTemporaryPassword: boolean,
  authorize?: (manager: EntityManager) => Promise<void>,
): Promise<void> {
  await context.reauthorize?.(manager);
  const users = await manager.query(
    'SELECT id FROM app_user WHERE id=$1 AND is_active AND (NOT must_change_password OR $2) FOR SHARE',
    [actorUserId, allowTemporaryPassword],
  );
  if (!users.length)
    throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
  if (authorize) await authorize(manager);
  else {
    const roles = await manager.query(
      "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='ADMIN' AND site_id IS NULL FOR SHARE",
      [actorUserId],
    );
    if (!roles.length)
      throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
  }
}

/** Name-only writes retain transactional authorization without fabricating authority history. */
export async function executeMainMetadataMutation<T>(
  source: DataSource,
  context: MainConfigurationCommandContext | undefined,
  work: (manager: EntityManager) => Promise<T>,
  authorize?: (manager: EntityManager) => Promise<void>,
): Promise<T> {
  if (!context) return source.transaction(work);
  const actorUserId = uuid(context.actorUserId).toLowerCase();
  return withZoneAuthorityTransaction(source, async (manager) => {
    await assertConfigurationActor(manager, context, actorUserId, false, authorize);
    return work(manager);
  });
}

/** Preserve the existing API while the additive retained-main migration is not installed. */
export async function executeMainConfigurationCommand<T>(
  source: DataSource,
  context: MainConfigurationCommandContext | undefined,
  operation: Operation,
  request: object,
  work: (manager: EntityManager) => Promise<T>,
  authorize?: (manager: EntityManager) => Promise<void>,
): Promise<T> {
  // Legacy internal callers have no authenticated actor. Capture triggers, if installed,
  // mark their writes unattributed; never fabricate a service/user or trusted history.
  const actorUserId = context ? uuid(context.actorUserId).toLowerCase() : null;
  const commandId = randomUUID();
  const requestHash = context
    ? computeCanonicalPayloadHash({ operation, actorUserId, request })
    : null;
  const transactionWork = async (manager: EntityManager) => {
    if (operation === 'MAIN_AUTHORITY_BASELINE') {
      // LOCK is deliberately before every SELECT/auth read: SERIALIZABLE's first
      // data snapshot must be established only after source writers have drained.
      await manager.query("SET LOCAL lock_timeout='1000ms'");
      await manager.query("SET LOCAL statement_timeout='1500ms'");
      await manager.query(
        `LOCK TABLE ${MAIN_AUTHORITY_SOURCES.map(([, table]) => table).join(',')} IN SHARE MODE`,
      );
    }
    // Account writers acquire MAIN's Admin invariant lock before actor share locks.
    if (operation.startsWith('USER_'))
      await manager.query('SELECT pg_advisory_xact_lock(48484, 1)');
    if (context && actorUserId)
      await assertConfigurationActor(
        manager,
        context,
        actorUserId,
        operation === 'USER_PASSWORD_CHANGE',
        authorize,
      );

    const installed = await manager.query(
      "SELECT count(*) FILTER(WHERE c.relname=ANY($1::text[]))::int AS n, count(*) FILTER(WHERE c.relname=ANY($2::text[]))::int AS legacy FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r'",
      [relations, PRE_NAMING_AUTHORITY_RELATIONS],
    );
    if (installed[0]?.legacy > 0) unavailable();
    if (installed[0]?.n === 0) return { value: await work(manager), journaled: false };
    if (installed[0]?.n !== relations.length) unavailable();
    let captures =
      operation === 'MAIN_AUTHORITY_BASELINE'
        ? MAIN_AUTHORITY_SOURCES.map(([, table]) => table)
        : operation === 'USER_CONTRACTOR_WORKER_ACCOUNT_CREATE'
          ? ['app_user', 'user_role_assignment', 'worker']
          : operation === 'WORKER_PROFILE_UPDATE'
            ? ['worker', 'site']
            : operation === 'USER_SITE_REPRESENTATIVE_CREATE'
              ? [
                  'app_user',
                  'user_role_assignment',
                  'contractor_representative_grant',
                  'contractor_representative_assignment',
                ]
              : operation === 'USER_ACCOUNT_CREATE' || operation === 'USER_ROLE_REPLACE'
                ? ['app_user', 'user_role_assignment']
                : operation === 'USER_ACCOUNT_STATUS' ||
                    operation === 'USER_PASSWORD_RESET' ||
                    operation === 'USER_PASSWORD_CHANGE'
                  ? ['app_user']
                  : operation === 'MAIN_REPRESENTATIVE_ASSIGN'
                    ? ['contractor_representative_grant', 'contractor_representative_assignment']
                    : operation === 'MAIN_REPRESENTATIVE_GRANT'
                      ? ['contractor_representative_grant']
                      : operation === 'SITE_CONTRACTOR_CREATE'
                        ? ['contractor']
                        : operation === 'CONTRACTOR_CREATE'
                          ? ['contractor']
                          : operation === 'CONTRACTOR_WORKER_CREATE' ||
                              operation === 'WORKER_ROSTER_CREATE' ||
                              operation === 'WORKER_ACCOUNT_PREPARE' ||
                              operation === 'WORKER_ACCOUNT_LINK'
                            ? ['worker']
                            : operation === 'MAIN_PARTICIPATION_CREATE'
                              ? ['contractor_site_participation']
                              : operation === 'CONTRACTOR_ZONE_GRANT' ||
                                  operation === 'CONTRACTOR_ZONE_REVOKE'
                                ? ['contractor_zone_permission', 'site']
                                : operation === 'WORKER_ZONE_GRANT' ||
                                    operation === 'WORKER_ZONE_REVOKE'
                                  ? ['worker_zone_permission', 'site']
                                  : operation === 'ASSIGNMENT_REQUEST' ||
                                      operation === 'ASSIGNMENT_SAFETY_REVIEW'
                                    ? ['worker_site_zone_assignment']
                                    : operation === 'ASSIGNMENT_DECISION' ||
                                        operation === 'ASSIGNMENT_REVOKE'
                                      ? ['worker_site_zone_assignment', 'site']
                                      : operation === 'SITE_CREATE'
                                        ? ['site']
                                        : operation === 'ZONE_CREATE' ||
                                            operation === 'ZONE_POLICY_UPDATE'
                                          ? ['zone']
                                          : operation === 'ZONE_DENY_CREATE' ||
                                              operation === 'ZONE_DENY_REVOKE'
                                            ? ['zone_access_grant']
                                            : ['camera', 'camera_observation_region', 'zone'];
    if (operation.startsWith('TEAM_'))
      captures = ['contractor_team', 'contractor_team_membership', 'team_zone_permission'];
    if (!(await hasMainAuthorityCapture(manager, captures))) unavailable();
    if (!context) return { value: await work(manager), journaled: false };
    const nested = await manager.query(
      "SELECT current_setting('smartsite.mf06_command_id',true) AS value",
    );
    if (nested[0]?.value) conflict('Nested authority commands are not supported');
    await manager.query(
      'INSERT INTO authorization_history_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,$3,$4)',
      [commandId, actorUserId, operation, requestHash],
    );
    await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
    const value = await work(manager);
    await manager.query("SELECT set_config('smartsite.mf06_command_id','',true)");
    return { value, journaled: true };
  };
  // Login holds the account row lock before inserting its session, but does not
  // update that row. A snapshot frozen before waiting for the account lock can
  // therefore miss the newly committed session. These four revocation commands
  // need fresh statement snapshots after the lock; actor/target locks, MAIN's
  // Admin invariant lock, capture journal and complete-transaction retry remain.
  const revokesAccountSessions =
    operation === 'USER_ACCOUNT_STATUS' ||
    operation === 'USER_ROLE_REPLACE' ||
    operation === 'USER_PASSWORD_RESET' ||
    operation === 'USER_PASSWORD_CHANGE';
  // Account-first enrollment locks the target account before looking for its
  // Worker. A waiter must see the first creator's committed Worker after that
  // lock, rather than reuse a pre-lock SERIALIZABLE snapshot and report409.
  const refreshAfterAccountLock = revokesAccountSessions || operation === 'WORKER_ACCOUNT_PREPARE';
  const result = await (
    context
      ? withZoneAuthorityTransaction(
          source,
          transactionWork,
          refreshAfterAccountLock ? 'READ COMMITTED' : 'SERIALIZABLE',
        )
      : source.transaction(transactionWork)
  ).catch((error: unknown) => {
    const code =
      error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
    if (code === '42P01' || code === '42703' || code === '42883') unavailable();
    throw error;
  });
  if (result.journaled) {
    try {
      await source.query(
        'INSERT INTO authorization_history_commit_receipt(command_id,transaction_id) SELECT command_id,transaction_id FROM authorization_history_command WHERE command_id=$1',
        [commandId],
      );
    } catch {
      // The business mutation already committed. Existing create DTOs have no caller
      // idempotency key: reporting a retryable failure would invite duplicate creation.
      // Without a witness, historical authority remains unconfirmed; no READY claim.
      new Logger('MainConfigurationAuthority').warn({
        commandId,
        action: 'configuration.authority_witness_unconfirmed',
      });
    }
  }
  return result.value;
}
