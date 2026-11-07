import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../../common/configuration/main-team-authority-sources.js';
import { ZONE_ENTRY_STORAGE_NAMES } from '../../../common/configuration/zone-entry-storage-profile-v1.js';
import type { BackendEnvironment } from '../../../config/environment.js';
import {
  verifyMainAuthorityCutoverRelease,
  type MainAuthorityCutoverReleaseConfig,
} from '../../zones/main-authority-cutover-release.js';
import { MainQualifiedAuthorityReader } from '../../zones/main-qualified-authority.reader.js';
import { SafetyFaceCandidateReader } from '../../workforce/safety-face-candidate.reader.js';
import { SafetyFaceProfileMetadataReader } from '../../workforce/safety-face-profile.reader.js';
import { Mf06AssessmentStore } from './mf06-assessment-store.service.js';
import {
  Mf06AssessmentWorker,
  type Mf06WorkerOptions,
  type Mf06WorkerResult,
} from './mf06-assessment-worker.service.js';
import { Mf06CandidateMetadataService } from './mf06-candidate-metadata.service.js';
import { Mf06ClaimContextReader } from './mf06-claim-context.reader.js';
import { HttpSafetyIdentityResolver } from './mf06-face-http-resolver.js';
import { Mf06FacePreparation, type Mf06FacePreparationResult } from './mf06-face-preparation.js';
import {
  Mf06JobLeaseService,
  type Mf06JobClaim,
  type Mf06LeaseOptions,
} from './mf06-job-lease.service.js';
import { Mf06ZoneEntryAssessmentWorkPort } from './mf06-zone-entry-assessment-work.port.js';

const LEASE_OPTIONS: Readonly<Mf06LeaseOptions> = Object.freeze({
  leaseSeconds: 30,
  maxAttempts: 3,
  retryDelaySeconds: 5,
});

// Keep the worker's drain bounded to 15 seconds; Nest owns application teardown.
const WORKER_OPTIONS: Readonly<Mf06WorkerOptions> = Object.freeze({
  enabled: true,
  resolverTimeoutMs: 10_000,
  drainTimeoutMs: 15_000,
  maxDatabaseAttempts: 3,
});

const RELEASE_VERIFY_TIMEOUT_MS = 10_000;
const ACTIVE_TICK_MS = 25;
const IDLE_TICK_MS = 1_000;
const PAUSE_RETRY_MS = 1_000;
const AUTHORITY_SOURCES = MAIN_AUTHORITY_V2_SOURCES.map(([, table]) => table);
const AUTHORITY_JOURNAL = Object.values(ZONE_ENTRY_STORAGE_NAMES).filter(
  (table) => table.startsWith('authorization_history_') || table.endsWith('_command_receipt'),
);

/**
 * Explicit fail-closed Face preparation when MF06 Face identity is not configured.
 * Does not invent a modelVersion or perform media/HTTP I/O; NONE/PROHIBITED policies
 * bypass Face preparation in WorkPort, while AUTHORIZATION_REQUIRED records IDENTITY_UNAVAILABLE.
 */
export class UnavailableMf06FacePreparation implements Pick<Mf06FacePreparation, 'prepare'> {
  async prepare(_claim: Mf06JobClaim, signal: AbortSignal): Promise<Mf06FacePreparationResult> {
    if (!(signal instanceof AbortSignal)) {
      throw new Error('MF06_ABORT_SIGNAL_REQUIRED');
    }
    signal.throwIfAborted();
    return Object.freeze({ state: 'UNAVAILABLE', reason: 'IDENTITY_UNAVAILABLE' });
  }
}

@Injectable()
export class Mf06AssessmentWorkerRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Mf06AssessmentWorkerRuntime.name);
  private releaseConfig: MainAuthorityCutoverReleaseConfig | null = null;
  private nodeEnv: BackendEnvironment['NODE_ENV'] = 'development';
  private worker: Mf06AssessmentWorker | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeTick: Promise<void> | undefined;
  private stopping = false;
  private readonly loopAbort = new AbortController();

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('MF06_WORKER_ENABLED', { infer: true }) !== true) {
      return;
    }

    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
      throw new Error('MF06_INVALID_NODE_ENV');
    }

    const manifestPath = this.config.get('MF06_CUTOVER_MANIFEST_PATH', { infer: true });
    const reviewedManifestSha256 = this.config.get('MF06_CUTOVER_MANIFEST_SHA256', { infer: true });
    const releaseRoot = this.config.get('MF06_CUTOVER_RELEASE_ROOT', { infer: true });
    const releaseCommit = this.config.get('MF06_CUTOVER_RELEASE_COMMIT', { infer: true });
    if (!manifestPath || !reviewedManifestSha256 || !releaseRoot || !releaseCommit) {
      throw new Error('MF06_CUTOVER_RELEASE_CONFIG_REQUIRED');
    }

    const identityUrl = this.config.get('SMARTSITE_AI_IDENTITY_URL', { infer: true });
    const modelVersion = this.config.get('MF06_FACE_MODEL_VERSION', { infer: true });
    const evidenceRoot = this.config.get('EVIDENCE_LOCAL_ROOT', { infer: true });
    const serviceToken = this.config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true });
    const hasIdentity = identityUrl !== undefined || modelVersion !== undefined;

    const releaseConfig: MainAuthorityCutoverReleaseConfig = Object.freeze({
      manifestPath,
      reviewedManifestSha256,
      releaseRoot,
      releaseCommit,
    });

    if (nodeEnv === 'production') await this.verifyDatabaseRole();
    await this.verifyRelease(releaseConfig, nodeEnv);
    if (this.stopping || this.loopAbort.signal.aborted) {
      throw new Error('MF06_RUNTIME_ABORTED');
    }

    const leases = new Mf06JobLeaseService(this.db, LEASE_OPTIONS);
    const contexts = new Mf06ClaimContextReader(this.db);
    const authority = new MainQualifiedAuthorityReader(this.db, releaseConfig, this.config);
    let facePreparation: Pick<Mf06FacePreparation, 'prepare'> =
      new UnavailableMf06FacePreparation();
    if (hasIdentity) {
      if (!identityUrl || !modelVersion || !evidenceRoot || !serviceToken)
        throw new Error('MF06_PARTIAL_IDENTITY_CONFIG');
      facePreparation = new Mf06FacePreparation(
        contexts,
        new SafetyFaceCandidateReader(this.db),
        new HttpSafetyIdentityResolver(identityUrl, serviceToken),
        evidenceRoot,
        modelVersion,
      );
    }
    const candidateMetadata = new Mf06CandidateMetadataService(
      new SafetyFaceProfileMetadataReader(),
      hasIdentity ? 'TRUSTED_SERVICE' : 'DISABLED',
    );
    const store = new Mf06AssessmentStore(this.db);
    const workPort = new Mf06ZoneEntryAssessmentWorkPort(
      this.db,
      contexts,
      authority,
      facePreparation,
      candidateMetadata,
      store,
    );

    this.worker = new Mf06AssessmentWorker(this.db, leases, workPort, WORKER_OPTIONS);
    this.releaseConfig = releaseConfig;
    this.nodeEnv = nodeEnv;
    this.scheduleNext(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.loopAbort.abort(new Error('MF06_RUNTIME_ABORTED'));
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.worker) {
      await this.worker.drain();
    }
    if (this.activeTick) {
      await this.activeTick;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopping || this.loopAbort.signal.aborted || !this.worker) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, delayMs);
    this.timer.unref();
  }

  private tick(): Promise<void> {
    if (this.stopping || this.loopAbort.signal.aborted || !this.worker || !this.releaseConfig) {
      return Promise.resolve();
    }
    if (this.activeTick) {
      return this.activeTick;
    }
    const current = this.executeTick().finally(() => {
      this.activeTick = undefined;
    });
    this.activeTick = current;
    return current;
  }

  private async executeTick(): Promise<void> {
    if (this.stopping || this.loopAbort.signal.aborted || !this.worker || !this.releaseConfig) {
      return;
    }
    const releaseConfig = this.releaseConfig;
    const worker = this.worker;

    try {
      await this.verifyRelease(releaseConfig, this.nodeEnv);
    } catch {
      if (this.stopping || this.loopAbort.signal.aborted) {
        return;
      }
      this.logger.warn({
        event: 'mf06_worker_tick_paused',
        reason: 'CUTOVER_RELEASE_INVALIDATED',
      });
      this.scheduleNext(PAUSE_RETRY_MS);
      return;
    }

    if (this.stopping || this.loopAbort.signal.aborted) {
      return;
    }

    let nextDelayMs = IDLE_TICK_MS;
    try {
      const outcome: Mf06WorkerResult = await worker.runOnce(this.loopAbort.signal);
      if (
        outcome === 'COMPLETED' ||
        outcome === 'RETRY' ||
        outcome === 'FAILED' ||
        outcome === 'STALE'
      ) {
        nextDelayMs = ACTIVE_TICK_MS;
      }
    } catch {
      if (this.stopping || this.loopAbort.signal.aborted) {
        return;
      }
      this.logger.error({
        event: 'mf06_worker_tick_paused',
        reason: 'WORKER_EXECUTION_FAILED',
      });
      nextDelayMs = PAUSE_RETRY_MS;
    }

    this.scheduleNext(nextDelayMs);
  }

  private async verifyDatabaseRole(): Promise<void> {
    const schema = this.db.driver.schema;
    if (typeof schema !== 'string' || !schema) {
      throw new Error('MF06_UNSAFE_RUNTIME_DATABASE_ROLE');
    }

    const safe = await this.db
      .transaction('READ COMMITTED', async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        const [result]: { safe: boolean }[] = await manager.query(
          `WITH target_schema AS (
            SELECT oid, nspowner FROM pg_catalog.pg_namespace
            WHERE nspname = $1 AND nspname = pg_catalog.current_schema()
          ), relations AS (
            SELECT c.oid, c.relowner
            FROM pg_catalog.pg_class c JOIN target_schema n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND c.relname::text = ANY($2::text[] || $3::text[])
          ), owners AS (
            SELECT nspowner AS oid FROM target_schema
            UNION SELECT relowner FROM relations
            UNION SELECT p.proowner FROM pg_catalog.pg_proc p
              JOIN target_schema n ON n.oid = p.pronamespace
              WHERE pg_catalog.starts_with(p.proname::text, 'mf06_')
          ), runtime_roles AS (
            SELECT oid, rolsuper FROM pg_catalog.pg_roles
            WHERE rolname IN (current_user, session_user)
              OR pg_catalog.pg_has_role(session_user, oid, 'SET')
          )
          SELECT EXISTS (SELECT 1 FROM target_schema)
            AND (SELECT count(*) FROM relations) = pg_catalog.cardinality($2::text[] || $3::text[])
            AND pg_catalog.pg_my_temp_schema() = 0
            AND pg_catalog.current_setting('transaction_read_only') = 'on'
            AND pg_catalog.current_setting('session_replication_role') = 'origin'
            AND NOT EXISTS (
              SELECT 1 FROM runtime_roles r WHERE r.rolsuper
                OR EXISTS (SELECT 1 FROM owners o WHERE pg_catalog.pg_has_role(r.oid, o.oid, 'USAGE'))
                OR EXISTS (
                  SELECT 1 FROM pg_catalog.pg_auth_members m
                  WHERE m.admin_option
                    AND pg_catalog.pg_has_role(r.oid, m.roleid, 'MEMBER WITH ADMIN OPTION')
                )
                OR EXISTS (
                  SELECT 1 FROM pg_catalog.pg_roles p
                  WHERE p.rolname IN ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
                    AND pg_catalog.pg_has_role(r.oid, p.oid, 'USAGE')
                )
                OR EXISTS (
                  SELECT 1 FROM relations t
                  WHERE pg_catalog.has_table_privilege(r.oid, t.oid, 'TRIGGER')
                )
                OR pg_catalog.has_parameter_privilege(r.oid, 'session_replication_role', 'SET')
                OR pg_catalog.has_parameter_privilege(r.oid, 'session_replication_role', 'ALTER SYSTEM')
            ) AS safe`,
          [schema, AUTHORITY_SOURCES, AUTHORITY_JOURNAL],
        );
        return result?.safe === true;
      })
      .catch(() => {
        throw new Error('MF06_RUNTIME_DATABASE_ROLE_UNVERIFIED');
      });
    if (!safe) throw new Error('MF06_UNSAFE_RUNTIME_DATABASE_ROLE');
  }

  private verifyRelease(
    config: MainAuthorityCutoverReleaseConfig,
    environment: BackendEnvironment['NODE_ENV'],
  ) {
    const signal = AbortSignal.any([
      this.loopAbort.signal,
      AbortSignal.timeout(RELEASE_VERIFY_TIMEOUT_MS),
    ]);
    return abortRace(() => verifyMainAuthorityCutoverRelease(config, environment, signal), signal);
  }
}

function abortRace<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (ok) resolve(value as T);
      else reject(value);
    };
    const onAbort = () => finish(false, signal.reason ?? new Error('MF06_RUNTIME_ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(
        (value) => finish(true, value),
        (error) => finish(false, error),
      );
  });
}
