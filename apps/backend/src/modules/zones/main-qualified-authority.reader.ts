import { DataSource, type EntityManager } from 'typeorm';
import { databaseErrorCode, isDatabaseConnectionFailure } from '../../common/database-errors.js';
import type { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';
import { hasMainAuthorityCapture } from '../../common/configuration/main-authority-capture-preflight.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../common/configuration/main-team-authority-sources.js';
import {
  decodeStoredMainAuthorityArchive,
  MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
  parseMainAuthorityInstant,
  type MainAuthorityArchive,
  type MainAuthorityArchiveContext,
} from './main-authority-archive-codec.js';
import { baselineSourceProfile } from './main-authority-baseline-profile.js';
import {
  MainAuthorityCapturedStateReader,
  type MainCapturedStateInput,
} from './main-authority-captured-state.reader.js';
import {
  verifyMainAuthorityCutoverRelease,
  type MainAuthorityCutoverReleaseConfig,
} from './main-authority-cutover-release.js';
import {
  MainAuthoritySnapshotUnavailable,
  MAIN_AUTHORITY_SNAPSHOT_TABLES,
  readMainAuthoritySnapshot,
} from './main-authority-read-snapshot.js';

export interface MainQualifiedAuthorityPrepared {
  readonly status: 'QUALIFIED';
  readonly archive: MainAuthorityArchive;
  readonly epochId: string;
  readonly epochState: 'READY' | 'GAPPED' | 'CLOSED';
  readonly activatedAt: string;
  readonly gappedAt: string | null;
  readonly closedAt: string | null;
  readonly witnessConfirmedAt: string;
  readonly manifestSha256: string;
  readonly releaseCommit: string;
  readonly sourceRegistryHash: string;
  readonly provenance: 'OPERATIONAL_REVIEWED' | 'SYNTHETIC_TEST';
  readonly operationalAuthorityCoverageEstablished: boolean;
  readonly syntheticCutoverMechanicsVerified: boolean;
  readonly identityEstablished: false;
}
export type MainQualifiedAuthorityResult =
  { readonly status: 'UNAVAILABLE'; readonly reason: string } | MainQualifiedAuthorityPrepared;

interface EpochQualificationRow {
  epoch_id: string;
  state: 'STAGING' | 'READY' | 'GAPPED' | 'CLOSED';
  writer_manifest_hash: string;
  source_registry_hash: string;
  snapshot_hash: string;
  captured_at: string;
  activated_at: string | null;
  gapped_at: string | null;
  closed_at: string | null;
  witness_confirmed_at: string | null;
  schema_valid: boolean;
  isolation_valid: boolean;
  locks_held: boolean;
  not_future: boolean;
  read_only: boolean;
  cutover_guard_present: boolean;
  origin_valid: boolean;
  witness_valid: boolean;
  window_valid: boolean;
  has_gap_upto_t: boolean;
  gap_window_valid: boolean;
  revision_state_hash: string;
  revision_count: number;
}
const unavailable = (reason: string): MainQualifiedAuthorityResult => ({
  status: 'UNAVAILABLE',
  reason,
});
const currentV2Archive = (archive: MainAuthorityArchive): boolean =>
  archive.format === MAIN_AUTHORITY_ARCHIVE_FORMAT_V2 &&
  baselineSourceProfile(archive.payload.sources, MAIN_AUTHORITY_V2_SOURCES) === 'CURRENT';

/** Qualified event-time authority wrapper. Never promotes candidate/profile to verified Worker. */
export class MainQualifiedAuthorityReader {
  private readonly release: MainAuthorityCutoverReleaseConfig;
  private readonly environment: BackendEnvironment['NODE_ENV'];
  private readonly attestations = new WeakMap<MainQualifiedAuthorityPrepared, string>();

  constructor(
    private readonly source: DataSource,
    release: MainAuthorityCutoverReleaseConfig,
    runtime: ConfigService<BackendEnvironment, true>,
    private readonly reader = new MainAuthorityCapturedStateReader(),
  ) {
    this.release = Object.freeze({ ...release });
    this.environment = runtime.get('NODE_ENV', { infer: true });
  }

  async prepare(input: MainCapturedStateInput): Promise<MainQualifiedAuthorityResult> {
    const release = await verifyMainAuthorityCutoverRelease(this.release, this.environment).catch(
      () => null,
    );
    if (!release) return unavailable('RELEASE_UNAVAILABLE');
    return readMainAuthoritySnapshot(this.source, (manager) =>
      this.prepareInSnapshot(manager, input, release),
    ).catch((error: unknown) => this.mapDatabaseError(error, false));
  }

  /** The event time selects history; the current control pointer is never a fallback. */
  async prepareForEvent(
    context: MainAuthorityArchiveContext,
    signal?: AbortSignal,
  ): Promise<MainQualifiedAuthorityResult> {
    signal?.throwIfAborted();
    if (
      typeof context?.capturedAt !== 'string' ||
      parseMainAuthorityInstant(context.capturedAt) === null
    )
      return unavailable('INVALID_CAPTURE_TIME');
    const release = await verifyMainAuthorityCutoverRelease(
      this.release,
      this.environment,
      signal,
    ).catch(() => null);
    signal?.throwIfAborted();
    if (!release) return unavailable('RELEASE_UNAVAILABLE');
    const result = await readMainAuthoritySnapshot(this.source, async (manager) => {
      signal?.throwIfAborted();
      if (!(await hasMainAuthorityCapture(manager))) return unavailable('CAPTURE_UNAVAILABLE');
      const epochs: { epoch_id: string }[] = await manager.query(
        `SELECT epoch_id FROM authorization_history_epoch
         WHERE writer_manifest_hash=$2 AND activated_at<=$1::timestamptz
           AND (closed_at IS NULL OR $1::timestamptz<closed_at)
         ORDER BY activated_at DESC,epoch_id LIMIT 2`,
        [context.capturedAt, release.manifestSha256],
      );
      signal?.throwIfAborted();
      if (epochs.length !== 1) return unavailable('EPOCH_WINDOW_UNQUALIFIED');
      return this.prepareInSnapshot(manager, { ...context, epochId: epochs[0]!.epoch_id }, release);
    }).catch((error: unknown) => this.mapDatabaseError(error, false));
    signal?.throwIfAborted();
    return result;
  }

  private async prepareInSnapshot(
    manager: EntityManager,
    input: MainCapturedStateInput,
    release: Awaited<ReturnType<typeof verifyMainAuthorityCutoverRelease>>,
  ): Promise<MainQualifiedAuthorityResult> {
    const reconstructed = await this.reader.read(manager, input);
    if (reconstructed.status !== 'RECONSTRUCTED') return unavailable(reconstructed.reason);
    const { archive } = reconstructed;
    if (!currentV2Archive(archive)) return unavailable('SOURCE_REGISTRY_MISMATCH');
    const row = await this.qualifyEpoch(manager, input.epochId, input.capturedAt);
    if ('status' in row) return row;
    const base = archive.payload.baseline;
    if (
      row.writer_manifest_hash !== release.manifestSha256 ||
      row.source_registry_hash !== release.sourceRegistryHash ||
      base.epochId !== row.epoch_id ||
      base.declaredWriterManifestHash !== release.manifestSha256 ||
      base.sourceRegistryHash !== release.sourceRegistryHash ||
      row.snapshot_hash !== base.snapshotHash ||
      row.captured_at !== base.capturedAt
    )
      return unavailable('CUTOVER_MANIFEST_MISMATCH');
    const prepared: MainQualifiedAuthorityPrepared = Object.freeze({
      status: 'QUALIFIED',
      archive,
      epochId: row.epoch_id,
      epochState: row.state as 'READY' | 'GAPPED' | 'CLOSED',
      activatedAt: row.activated_at!,
      gappedAt: row.gapped_at,
      closedAt: row.closed_at,
      witnessConfirmedAt: row.witness_confirmed_at!,
      manifestSha256: release.manifestSha256,
      releaseCommit: release.releaseCommit,
      sourceRegistryHash: release.sourceRegistryHash,
      provenance: release.provenance,
      operationalAuthorityCoverageEstablished: release.provenance === 'OPERATIONAL_REVIEWED',
      syntheticCutoverMechanicsVerified: true,
      identityEstablished: false,
    });
    this.attestations.set(prepared, row.revision_state_hash);
    return prepared;
  }

  /** Caller's writable SERIALIZABLE TX must acquire the ordered20-table fence before its first SELECT. */
  async revalidate(
    manager: EntityManager,
    input: MainCapturedStateInput,
    prepared: MainQualifiedAuthorityPrepared,
  ): Promise<MainQualifiedAuthorityResult> {
    const revisionStateHash = this.attestations.get(prepared);
    if (!revisionStateHash) return unavailable('UNTRUSTED_PREPARED_ARCHIVE');
    if (
      prepared.manifestSha256 !== this.release.reviewedManifestSha256 ||
      prepared.releaseCommit !== this.release.releaseCommit ||
      (prepared.provenance === 'SYNTHETIC_TEST' && this.environment !== 'test')
    )
      return unavailable('RELEASE_UNAVAILABLE');
    if (!manager.queryRunner?.isTransactionActive) return unavailable('TRANSACTION_REQUIRED');
    if (typeof input?.epochId !== 'string' || input.epochId.toLowerCase() !== prepared.epochId)
      return unavailable('BINDING_MISMATCH');
    const { epochId, ...context } = input;
    const decoded = decodeStoredMainAuthorityArchive(prepared.archive, {
      ...context,
      sha256: prepared.archive.sha256,
    });
    if (decoded.status !== 'VALID') return unavailable(decoded.reason);
    if (!currentV2Archive(decoded.archive)) return unavailable('SOURCE_REGISTRY_MISMATCH');
    try {
      const row = await this.qualifyEpoch(manager, prepared.epochId, input.capturedAt);
      if ('status' in row) return row;
      if (row.read_only) return unavailable('WRITABLE_TRANSACTION_REQUIRED');
      const base = decoded.archive.payload.baseline;
      if (
        row.state !== prepared.epochState ||
        base.epochId !== epochId.toLowerCase() ||
        base.declaredWriterManifestHash !== prepared.manifestSha256 ||
        base.sourceRegistryHash !== prepared.sourceRegistryHash ||
        row.closed_at !== prepared.closedAt ||
        row.gapped_at !== prepared.gappedAt ||
        row.writer_manifest_hash !== prepared.manifestSha256 ||
        row.source_registry_hash !== prepared.sourceRegistryHash ||
        row.snapshot_hash !== base.snapshotHash ||
        row.captured_at !== base.capturedAt ||
        row.activated_at !== prepared.activatedAt ||
        row.witness_confirmed_at !== prepared.witnessConfirmedAt ||
        row.revision_state_hash !== revisionStateHash
      )
        return unavailable('CUTOVER_STATE_DRIFT');
      return prepared;
    } catch (error) {
      return this.mapDatabaseError(error, true);
    }
  }

  private async qualifyEpoch(manager: EntityManager, epochId: string, capturedAt: string) {
    const schema = this.source.driver.schema;
    if (typeof schema !== 'string' || !schema || schema.includes('\0'))
      return unavailable('SNAPSHOT_FENCE_REQUIRED');
    if (!(await hasMainAuthorityCapture(manager))) return unavailable('CAPTURE_UNAVAILABLE');
    const [row]: EpochQualificationRow[] = await manager.query(
      `SELECT e.epoch_id,e.state,e.writer_manifest_hash,b.source_registry_hash,b.snapshot_hash,
        to_char(b.captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS captured_at,
        to_char(e.activated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activated_at,
        to_char(e.gapped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS gapped_at,
        to_char(e.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at,
        to_char(w.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS witness_confirmed_at,
        current_schema()=$3::text AND pg_catalog.pg_my_temp_schema()=0 AS schema_valid, current_setting('transaction_isolation')='serializable' AS isolation_valid,
        current_setting('transaction_read_only')='on' AS read_only,
        NOT EXISTS(SELECT 1 FROM unnest($4::text[]) AS required(name)
          LEFT JOIN pg_class r ON r.relname=required.name AND r.relkind='r' AND r.relnamespace=current_schema()::regnamespace
          WHERE r.oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid() AND l.granted AND l.relation=r.oid
            AND l.mode IN ('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))) AS locks_held,
        $2::timestamptz<=transaction_timestamp() AND $2::timestamptz<=statement_timestamp() AS not_future,
        EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname='mf06_authority_control_guard') AS cutover_guard_present,
        b.transaction_id=c.transaction_id AND c.operation='MAIN_AUTHORITY_BASELINE' AND b.captured_at=e.baseline_at AS origin_valid,
        COALESCE(w.transaction_id=c.transaction_id AND w.confirmed_at<=$2::timestamptz,false) AS witness_valid,
        e.activated_at IS NOT NULL AND e.state IN ('READY','GAPPED','CLOSED') AND $2::timestamptz>=b.captured_at AND $2::timestamptz>=e.activated_at
          AND ((e.state IN ('READY','GAPPED') AND e.closed_at IS NULL AND e.epoch_id=(SELECT epoch_id FROM authorization_history_control WHERE singleton=1))
            OR (e.state='CLOSED' AND e.closed_at IS NOT NULL AND $2::timestamptz<e.closed_at AND e.epoch_id IS DISTINCT FROM (SELECT epoch_id FROM authorization_history_control WHERE singleton=1))) AS window_valid,
        EXISTS(SELECT 1 FROM authorization_history_gap g WHERE (g.epoch_id=e.epoch_id OR g.observed_at>=b.captured_at) AND g.observed_at<=$2::timestamptz) AS has_gap_upto_t,
        (e.gapped_at IS NULL OR $2::timestamptz<e.gapped_at)
          AND (e.state<>'GAPPED' OR e.gapped_at IS NOT NULL) AS gap_window_valid,
        tail.revision_count,tail.revision_state_hash
      FROM authorization_history_epoch e JOIN authorization_history_baseline b USING(epoch_id)
      JOIN authorization_history_command c USING(command_id) LEFT JOIN authorization_history_commit_receipt w USING(command_id)
      LEFT JOIN LATERAL (SELECT count(*)::integer AS revision_count,
        COALESCE(encode(sha256(convert_to(jsonb_agg(jsonb_build_object('id',f.fact_id,'b',f.before_hash,'a',f.after_hash,
          'k',COALESCE(rc.transaction_id=f.transaction_id AND rw.transaction_id=f.transaction_id AND rw.confirmed_at>=f.observed_at AND rw.confirmed_at<=$2::timestamptz,false)
        ) ORDER BY f.source_kind COLLATE "C",f.source_id,f.revision)::text,'UTF8')),'hex'),'EMPTY') AS revision_state_hash
        FROM (SELECT fact_id,before_hash,after_hash,transaction_id,command_id,observed_at,source_kind,source_id,revision
          FROM authorization_history_revision WHERE observed_at>b.captured_at AND observed_at<=$2::timestamptz LIMIT 2049) f
        LEFT JOIN authorization_history_command rc USING(command_id)
        LEFT JOIN authorization_history_commit_receipt rw USING(command_id)) tail ON true
      WHERE e.epoch_id=$1`,
      [epochId, capturedAt, schema, MAIN_AUTHORITY_SNAPSHOT_TABLES],
    );
    if (!row) return unavailable('BASELINE_UNAVAILABLE');
    if (!row.schema_valid || !row.isolation_valid || !row.locks_held)
      return unavailable('SNAPSHOT_FENCE_REQUIRED');
    if (!row.not_future) return unavailable('OBSERVATION_AFTER_TRANSACTION_START');
    if (row.revision_count > 2048) return unavailable('RESOURCE_LIMIT');
    if (!row.cutover_guard_present) return unavailable('CUTOVER_UNAVAILABLE');
    if (!row.origin_valid) return unavailable('BASELINE_INTEGRITY_UNAVAILABLE');
    if (!row.witness_valid) return unavailable('COMMIT_TIME_UNCERTAIN');
    if (row.has_gap_upto_t || !row.gap_window_valid) return unavailable('HISTORY_GAP');
    if (!row.window_valid) return unavailable('EPOCH_WINDOW_UNQUALIFIED');
    return row;
  }

  private mapDatabaseError(
    error: unknown,
    rethrowRetryable: boolean,
  ): MainQualifiedAuthorityResult {
    if (error instanceof MainAuthoritySnapshotUnavailable)
      return unavailable('SNAPSHOT_FENCE_REQUIRED');
    const code = databaseErrorCode(error);
    if (isDatabaseConnectionFailure(error)) return unavailable('DATABASE_UNAVAILABLE');
    if (rethrowRetryable && (code === '40001' || code === '40P01')) throw error;
    if (
      code &&
      ['55P03', '57014', '55000', '40001', '40P01', '42P01', '42703', '42883'].includes(code)
    )
      return unavailable('DATABASE_UNAVAILABLE');
    throw error;
  }
}
