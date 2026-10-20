/** Frozen cutover V1 SQL bodies; do not extend an applied protocol in place. */
import { createHash } from 'node:crypto';

export const PREDECESSOR_EPOCH_GUARD_BODY = `
      BEGIN
        IF TG_OP='INSERT' THEN
          IF NEW.state<>'STAGING' OR NEW.baseline_at IS NOT NULL OR NEW.closed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Controlled authority cutover is not installed' USING ERRCODE='23514';
          END IF;
          NEW.started_at:=clock_timestamp();
        ELSE
          IF pg_trigger_depth()=2 AND OLD.state='STAGING' AND NEW.state='STAGING'
            AND OLD.baseline_at IS NULL AND NEW.baseline_at IS NOT NULL
            AND (to_jsonb(NEW)-'baseline_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'baseline_at')
            AND EXISTS(SELECT 1 FROM authorization_history_baseline b WHERE b.epoch_id=NEW.epoch_id
              AND b.captured_at=NEW.baseline_at AND b.transaction_id=pg_current_xact_id()) THEN
            RETURN NEW;
          END IF;
          IF (to_jsonb(NEW)-'state'-'closed_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'closed_at')
            OR NEW.state NOT IN ('GAPPED','CLOSED') OR OLD.state='CLOSED' THEN
            RAISE EXCEPTION 'Authority epoch provenance cannot be rewritten or promoted' USING ERRCODE='23514';
          END IF;
          NEW.closed_at:=CASE WHEN NEW.state='CLOSED' THEN clock_timestamp() ELSE NULL END;
        END IF;
        RETURN NEW;
      END `;

export const CUTOVER_EPOCH_GUARD_BODY = `
      DECLARE
        raw_cmd text;
        cmd authorization_history_command%ROWTYPE;
        bl authorization_history_baseline%ROWTYPE;
        expected_reg_hash text;
      BEGIN
        IF TG_OP='INSERT' THEN
          IF NEW.state<>'STAGING' OR NEW.baseline_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.activated_at IS NOT NULL THEN
            RAISE EXCEPTION 'Controlled authority cutover requires STAGING epoch insert' USING ERRCODE='23514';
          END IF;
          NEW.started_at:=clock_timestamp();
        ELSE
          IF pg_trigger_depth()=2 AND OLD.state='STAGING' AND NEW.state='STAGING'
            AND OLD.baseline_at IS NULL AND NEW.baseline_at IS NOT NULL
            AND (to_jsonb(NEW)-'baseline_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'baseline_at')
            AND EXISTS(SELECT 1 FROM authorization_history_baseline b WHERE b.epoch_id=NEW.epoch_id
              AND b.captured_at=NEW.baseline_at AND b.transaction_id=pg_current_xact_id()) THEN
            RETURN NEW;
          END IF;
          IF pg_trigger_depth()=2 AND OLD.state='STAGING' AND NEW.state='READY'
            AND OLD.baseline_at IS NOT NULL AND OLD.closed_at IS NULL
            AND NEW.writer_manifest_hash ~ '^[0-9a-f]{64}$'
            AND (to_jsonb(NEW)-'state') IS NOT DISTINCT FROM (to_jsonb(OLD)-'state')
            AND COALESCE(current_setting('smartsite.mf06_cutover_epoch',true),'')=NEW.epoch_id::text
            AND EXISTS(SELECT 1 FROM authorization_history_control WHERE singleton=1 AND epoch_id=NEW.epoch_id) THEN
            IF current_setting('transaction_isolation')<>'serializable' OR current_setting('transaction_read_only')<>'off' THEN
          RAISE EXCEPTION 'Cutover requires SERIALIZABLE read-write transaction' USING ERRCODE='23514'; END IF;
        IF EXISTS(SELECT 1 FROM authorization_history_source s JOIN pg_class r ON r.relname=s.table_name AND r.relkind='r'
          JOIN pg_namespace n ON n.oid=r.relnamespace AND n.nspname=current_schema()
          WHERE NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid() AND l.granted AND l.relation=r.oid
            AND l.mode IN ('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))) THEN
          RAISE EXCEPTION 'Cutover requires held source locks' USING ERRCODE='23514'; END IF;
        raw_cmd:=COALESCE(NULLIF(current_setting('smartsite.mf06_command_id',true),''),'');
            IF raw_cmd !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
              RAISE EXCEPTION 'Controlled authority cutover requires an active baseline command' USING ERRCODE='23514';
            END IF;
            SELECT * INTO cmd FROM authorization_history_command
            WHERE command_id=raw_cmd::uuid AND transaction_id=pg_current_xact_id() AND operation='MAIN_AUTHORITY_BASELINE';
            IF NOT FOUND THEN
              RAISE EXCEPTION 'Controlled authority cutover requires a same-transaction baseline command' USING ERRCODE='23514';
            END IF;
            PERFORM 1 FROM app_user u JOIN user_role_assignment a ON a.user_id=u.id
            WHERE u.id=cmd.actor_user_id AND u.is_active AND NOT u.must_change_password
              AND a.role='ADMIN' AND a.site_id IS NULL FOR SHARE OF u,a;
            IF NOT FOUND THEN
              RAISE EXCEPTION 'Controlled authority cutover requires an active global Admin actor' USING ERRCODE='23514';
            END IF;
            SELECT * INTO bl FROM authorization_history_baseline WHERE epoch_id=NEW.epoch_id FOR SHARE;
            SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind COLLATE "C")::text,'UTF8')),'hex')
        INTO expected_reg_hash FROM authorization_history_source s;
            IF bl.epoch_id IS NULL OR bl.command_id<>cmd.command_id OR bl.transaction_id<>pg_current_xact_id()
              OR bl.captured_at<>NEW.baseline_at OR bl.hash_algorithm<>'POSTGRES_JSONB_TEXT_SHA256_V1'
              OR COALESCE(bl.snapshot_json->>'version','')<>'MF06_MAIN_BASELINE_JSONB_V1'
              OR COALESCE(bl.snapshot_json->>'epochId','')<>NEW.epoch_id::text

              OR COALESCE(bl.snapshot_json->>'declaredWriterManifestHash','')<>NEW.writer_manifest_hash
              OR jsonb_typeof(bl.snapshot_json->'sources')<>'array'
              OR jsonb_array_length(bl.snapshot_json->'sources')<>18
              OR bl.source_registry_hash IS DISTINCT FROM expected_reg_hash
              OR bl.snapshot_hash IS DISTINCT FROM encode(sha256(convert_to(bl.snapshot_json::text,'UTF8')),'hex')
              OR EXISTS(SELECT 1 FROM authorization_history_gap g WHERE g.epoch_id=NEW.epoch_id OR g.transaction_id=pg_current_xact_id())
              OR EXISTS(SELECT 1 FROM authorization_history_revision r WHERE r.epoch_id=NEW.epoch_id OR r.transaction_id=pg_current_xact_id()) THEN
              RAISE EXCEPTION 'Controlled authority cutover baseline provenance verification failed' USING ERRCODE='23514';
            END IF;
            NEW.activated_at:=clock_timestamp();
            RETURN NEW;
          END IF;
          IF (to_jsonb(NEW)-'state'-'closed_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'closed_at')
            OR NEW.state NOT IN ('GAPPED','CLOSED') OR OLD.state='CLOSED' THEN
            RAISE EXCEPTION 'Authority epoch provenance cannot be rewritten or promoted' USING ERRCODE='23514';
          END IF;
          NEW.closed_at:=CASE WHEN NEW.state='CLOSED' THEN clock_timestamp() ELSE NULL END;
        END IF;
        RETURN NEW;
      END `;

export const CUTOVER_CONTROL_GUARD_BODY = `
      DECLARE
        raw_cmd text;
        cmd authorization_history_command%ROWTYPE;
        ep authorization_history_epoch%ROWTYPE;
        bl authorization_history_baseline%ROWTYPE;
        old_ep authorization_history_epoch%ROWTYPE;
        expected_reg_hash text;
      BEGIN
        IF TG_OP<>'UPDATE' OR pg_trigger_depth()<>1 THEN
          RAISE EXCEPTION 'Controlled authority cutover requires a top-level control update' USING ERRCODE='23514';
        END IF;
        IF OLD.singleton<>1 OR NEW.singleton<>1 OR NEW.epoch_id IS NULL
          OR NEW.epoch_id IS NOT DISTINCT FROM OLD.epoch_id THEN
          RAISE EXCEPTION 'Controlled authority cutover requires a distinct non-null target epoch on singleton 1' USING ERRCODE='23514';
        END IF;
        IF current_setting('transaction_isolation')<>'serializable' OR current_setting('transaction_read_only')<>'off' THEN
          RAISE EXCEPTION 'Cutover requires SERIALIZABLE read-write transaction' USING ERRCODE='23514'; END IF;
        IF EXISTS(SELECT 1 FROM authorization_history_source s JOIN pg_class r ON r.relname=s.table_name AND r.relkind='r'
          JOIN pg_namespace n ON n.oid=r.relnamespace AND n.nspname=current_schema()
          WHERE NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid() AND l.granted AND l.relation=r.oid
            AND l.mode IN ('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))) THEN
          RAISE EXCEPTION 'Cutover requires held source locks' USING ERRCODE='23514'; END IF;
        raw_cmd:=COALESCE(NULLIF(current_setting('smartsite.mf06_command_id',true),''),'');
        IF raw_cmd !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'Controlled authority cutover requires an active baseline command' USING ERRCODE='23514';
        END IF;
        SELECT * INTO cmd FROM authorization_history_command
        WHERE command_id=raw_cmd::uuid AND transaction_id=pg_current_xact_id() AND operation='MAIN_AUTHORITY_BASELINE';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Controlled authority cutover requires a same-transaction baseline command' USING ERRCODE='23514';
        END IF;
        PERFORM 1 FROM app_user u JOIN user_role_assignment a ON a.user_id=u.id
        WHERE u.id=cmd.actor_user_id AND u.is_active AND NOT u.must_change_password
          AND a.role='ADMIN' AND a.site_id IS NULL FOR SHARE OF u,a;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Controlled authority cutover requires an active global Admin actor' USING ERRCODE='23514';
        END IF;
        SELECT * INTO ep FROM authorization_history_epoch WHERE epoch_id=NEW.epoch_id FOR UPDATE;
        IF NOT FOUND OR ep.state<>'STAGING' OR ep.baseline_at IS NULL OR ep.closed_at IS NOT NULL
          OR ep.writer_manifest_hash !~ '^[0-9a-f]{64}$' THEN
          RAISE EXCEPTION 'Controlled authority cutover target epoch must be a baselined STAGING epoch' USING ERRCODE='23514';
        END IF;
        SELECT * INTO bl FROM authorization_history_baseline WHERE epoch_id=NEW.epoch_id FOR SHARE;
        SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind COLLATE "C")::text,'UTF8')),'hex')
        INTO expected_reg_hash FROM authorization_history_source s;
        IF bl.epoch_id IS NULL OR bl.command_id<>cmd.command_id OR bl.transaction_id<>pg_current_xact_id()
          OR bl.captured_at<>ep.baseline_at OR bl.hash_algorithm<>'POSTGRES_JSONB_TEXT_SHA256_V1'
          OR COALESCE(bl.snapshot_json->>'version','')<>'MF06_MAIN_BASELINE_JSONB_V1'
          OR COALESCE(bl.snapshot_json->>'epochId','')<>NEW.epoch_id::text

          OR COALESCE(bl.snapshot_json->>'declaredWriterManifestHash','')<>ep.writer_manifest_hash
          OR jsonb_typeof(bl.snapshot_json->'sources')<>'array'
          OR jsonb_array_length(bl.snapshot_json->'sources')<>18
          OR bl.source_registry_hash IS DISTINCT FROM expected_reg_hash
          OR bl.snapshot_hash IS DISTINCT FROM encode(sha256(convert_to(bl.snapshot_json::text,'UTF8')),'hex')
          OR EXISTS(SELECT 1 FROM authorization_history_gap g WHERE g.epoch_id=NEW.epoch_id OR g.transaction_id=pg_current_xact_id())
          OR EXISTS(SELECT 1 FROM authorization_history_revision r WHERE r.epoch_id=NEW.epoch_id OR r.transaction_id=pg_current_xact_id()) THEN
          RAISE EXCEPTION 'Controlled authority cutover baseline provenance verification failed' USING ERRCODE='23514';
        END IF;
        IF OLD.epoch_id IS NOT NULL THEN
          SELECT * INTO old_ep FROM authorization_history_epoch WHERE epoch_id=OLD.epoch_id FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Previous control epoch is missing' USING ERRCODE='23514'; END IF;
          IF old_ep.state<>'CLOSED' THEN
            UPDATE authorization_history_epoch SET state='CLOSED' WHERE epoch_id=OLD.epoch_id;
          END IF;
        END IF;
        PERFORM set_config('smartsite.mf06_cutover_epoch',NEW.epoch_id::text,true);
        UPDATE authorization_history_epoch SET state='READY' WHERE epoch_id=NEW.epoch_id;
        PERFORM set_config('smartsite.mf06_cutover_epoch','',true);
        RETURN NEW;
      END `;

const sha256Pair = (body: string): readonly [string, string] => [
  createHash('sha256').update(body.replace(/\r\n/g, '\n'), 'utf8').digest('hex'),
  createHash('sha256').update(body.replace(/\r?\n/g, '\r\n'), 'utf8').digest('hex'),
];

export const AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS = {
  mf06_authority_epoch_guard: {
    before: sha256Pair(PREDECESSOR_EPOCH_GUARD_BODY),
    after: sha256Pair(CUTOVER_EPOCH_GUARD_BODY),
  },
  mf06_authority_control_guard: {
    after: sha256Pair(CUTOVER_CONTROL_GUARD_BODY),
  },
} as const;
