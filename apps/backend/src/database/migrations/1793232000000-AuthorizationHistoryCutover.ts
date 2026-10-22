import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PREDECESSOR_EPOCH_GUARD_BODY,
  CUTOVER_EPOCH_GUARD_BODY,
  CUTOVER_CONTROL_GUARD_BODY,
  AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS,
} from '../../common/configuration/authorization-history-cutover-bodies-v1.js';
import { hasNamedV2AuthorityCutoverPredecessor } from '../../common/configuration/authorization-history-cutover-predecessor-v1.js';
/** Unregistered capability candidate; no startup or production cutover. */
export class AuthorizationHistoryCutover1793232000000 implements MigrationInterface {
  name = 'AuthorizationHistoryCutover1793232000000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error(`${this.name} requires an active migration transaction`);
    const schema = await ownedSchema(runner);
    if (!(await hasNamedV2AuthorityCutoverPredecessor(runner.manager)))
      throw new Error('Exact named-V2 predecessor capture required');
    const schemaPath = '"' + schema + '", pg_catalog, pg_temp';
    const [epochBeforeLf, epochBeforeCrlf] =
      AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_epoch_guard.before;
    const [epochAfterLf, epochAfterCrlf] =
      AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_epoch_guard.after;
    const [ctrlAfterLf, ctrlAfterCrlf] =
      AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_control_guard.after;

    await runner.query(`
      DO $precheck$
      DECLARE
        owned_schema text := current_schema();
        rel text;
      BEGIN
        IF owned_schema IS NULL OR current_setting('session_replication_role',true) IS DISTINCT FROM 'origin' THEN
          RAISE EXCEPTION 'Controlled authority cutover requires owned schema and origin replication role' USING ERRCODE='23514';
        END IF;
        IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=owned_schema AND c.relkind='r' AND c.relname LIKE 'mf06_authority_%') THEN
          RAISE EXCEPTION 'Legacy mf06_authority_* relations must not coexist with canonical70 tables' USING ERRCODE='23514';
        END IF;
        FOREACH rel IN ARRAY ARRAY[
          'authorization_history_source','authorization_history_command','authorization_history_revision',
          'authorization_history_commit_receipt','authorization_history_gap','authorization_history_head',
          'authorization_history_epoch','authorization_history_control','authorization_history_baseline'
        ] LOOP
          IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=owned_schema AND c.relname=rel AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
            RAISE EXCEPTION 'Missing or invalid canonical70 table %', rel USING ERRCODE='23514';
          END IF;
          EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE', owned_schema, rel);
        END LOOP;
        IF (SELECT count(*) FROM authorization_history_source)<>18
          OR (SELECT count(*) FROM authorization_history_control WHERE singleton=1 AND epoch_id IS NULL)<>1
          OR EXISTS(SELECT 1 FROM authorization_history_epoch WHERE state IN ('READY','GAPPED')) THEN
          RAISE EXCEPTION 'Predecessor control/source/epoch state does not match pre-cutover canonical70' USING ERRCODE='23514';
        END IF;
        IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='authorization_history_epoch'::regclass
          AND attname IN ('activated_at','gapped_at') AND NOT attisdropped) THEN
          RAISE EXCEPTION 'Unexpected predecessor activation or gap column' USING ERRCODE='23514';
        END IF;
        IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=owned_schema AND p.proname='mf06_authority_control_guard')
          OR EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=owned_schema AND c.relname='authorization_history_control' AND t.tgname='trg_mf06_authority_control_update' AND NOT t.tgisinternal)
          OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=owned_schema AND NOT t.tgisinternal AND t.tgenabled='O'
              AND (c.relname,t.tgname) IN (
                ('authorization_history_epoch','trg_mf06_authority_epoch_guard'),
                ('authorization_history_epoch','trg_mf06_authority_epoch_delete'),
                ('authorization_history_epoch','trg_mf06_authority_epoch_truncate'),
                ('authorization_history_control','trg_mf06_authority_control_delete'),
                ('authorization_history_control','trg_mf06_authority_control_truncate'),
                ('authorization_history_baseline','trg_mf06_baseline_insert'),
                ('authorization_history_baseline','trg_mf06_baseline_link')
              ))<>7 THEN
          RAISE EXCEPTION 'Predecessor cutover trigger profile mismatch' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=owned_schema AND p.proname='mf06_authority_epoch_guard'
            AND p.prokind='f' AND NOT p.prosecdef AND p.proconfig IS NULL
            AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN ('${epochBeforeLf}','${epochBeforeCrlf}'))
          OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=owned_schema AND p.proname='mf06_authority_baseline_capture'
              AND p.prokind='f' AND NOT p.prosecdef
              AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN (
                '63486609b1b7506deb72b09fdb87dfa9bd23431157448d4e3f4d979df16af0d3',
                '034e9804df052f6d6f5b8e462723fa1b07e8f98a329e9399dd37852d15de250a'
              )) THEN
          RAISE EXCEPTION 'Predecessor epoch/baseline function profile mismatch' USING ERRCODE='23514';
        END IF;
      END $precheck$;
    `);

    await runner.query(`ALTER TABLE authorization_history_epoch
      ADD COLUMN activated_at timestamptz,
      ADD COLUMN gapped_at timestamptz,
      ADD CONSTRAINT chk_authorization_history_activation_time CHECK(
        (activated_at IS NULL OR (baseline_at IS NOT NULL AND activated_at>=baseline_at))
        AND (gapped_at IS NULL OR (
          gapped_at>=started_at
          AND (baseline_at IS NULL OR gapped_at>=baseline_at)
          AND (activated_at IS NULL OR gapped_at>=activated_at)
        ))
        AND (state<>'GAPPED' OR gapped_at IS NOT NULL)
        AND (state NOT IN ('STAGING','READY') OR gapped_at IS NULL)
        AND (closed_at IS NULL OR (
          closed_at>=started_at
          AND (baseline_at IS NULL OR closed_at>=baseline_at)
          AND (activated_at IS NULL OR closed_at>=activated_at)
          AND (gapped_at IS NULL OR closed_at>=gapped_at)
        ))
      )`);
    await runner.query(
      `CREATE OR REPLACE FUNCTION mf06_authority_epoch_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ${schemaPath} AS $fn$${CUTOVER_EPOCH_GUARD_BODY}$fn$`,
    );
    await runner.query(
      `CREATE OR REPLACE FUNCTION mf06_authority_control_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ${schemaPath} AS $fn$${CUTOVER_CONTROL_GUARD_BODY}$fn$`,
    );
    await runner.query(`
      CREATE TRIGGER trg_mf06_authority_control_update
      AFTER UPDATE ON authorization_history_control
      FOR EACH ROW EXECUTE FUNCTION mf06_authority_control_guard()
    `);
    await runner.query(`
      DO $postcheck$
      DECLARE owned_schema text := current_schema();
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=owned_schema AND p.proname='mf06_authority_epoch_guard' AND p.prokind='f' AND NOT p.prosecdef
            AND COALESCE(p.proconfig,ARRAY[]::text[]) = ARRAY[format('search_path=%I, pg_catalog, pg_temp',owned_schema)]
            AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN ('${epochAfterLf}','${epochAfterCrlf}'))
          OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=owned_schema AND p.proname='mf06_authority_control_guard' AND p.prokind='f' AND NOT p.prosecdef
              AND COALESCE(p.proconfig,ARRAY[]::text[]) = ARRAY[format('search_path=%I, pg_catalog, pg_temp',owned_schema)]
              AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN ('${ctrlAfterLf}','${ctrlAfterCrlf}'))
          OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid AND p.pronamespace=n.oid
            WHERE n.nspname=owned_schema AND c.relname='authorization_history_control'
              AND t.tgname='trg_mf06_authority_control_update' AND p.proname='mf06_authority_control_guard'
              AND t.tgenabled='O' AND t.tgtype=17 AND NOT t.tgisinternal AND t.tgnargs=0
              AND t.tgqual IS NULL AND t.tgconstraint=0) THEN
          RAISE EXCEPTION 'Installed cutover guard profile verification failed' USING ERRCODE='23514';
        END IF;
      END $postcheck$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error(`${this.name} rollback requires an active migration transaction`);
    await ownedSchema(runner);
    const [epochBeforeLf, epochBeforeCrlf] =
      AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_epoch_guard.before;
    const [epochAfterLf, epochAfterCrlf] =
      AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_epoch_guard.after;
    const [ctrlAfterLf, ctrlAfterCrlf] =
      AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_control_guard.after;

    await runner.query(`
      DO $downcheck$
      DECLARE owned_schema text := current_schema();
      BEGIN
        IF current_setting('session_replication_role',true) IS DISTINCT FROM 'origin' THEN
          RAISE EXCEPTION 'Cutover rollback requires origin replication role' USING ERRCODE='23514';
        END IF;
        LOCK TABLE authorization_history_control, authorization_history_epoch, authorization_history_baseline IN ACCESS EXCLUSIVE MODE;
        IF EXISTS(SELECT 1 FROM authorization_history_control WHERE epoch_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM authorization_history_epoch WHERE state IN ('READY','GAPPED','CLOSED') OR activated_at IS NOT NULL OR gapped_at IS NOT NULL) THEN
          RAISE EXCEPTION 'Cannot roll back controlled authority cutover after epoch adoption, gap, or retirement' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=owned_schema AND p.proname='mf06_authority_epoch_guard'
            AND p.prokind='f' AND NOT p.prosecdef
            AND COALESCE(p.proconfig,ARRAY[]::text[])=ARRAY[format('search_path=%I, pg_catalog, pg_temp',owned_schema)]
            AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN ('${epochAfterLf}','${epochAfterCrlf}'))
          OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=owned_schema AND p.proname='mf06_authority_control_guard'
              AND p.prokind='f' AND NOT p.prosecdef
              AND COALESCE(p.proconfig,ARRAY[]::text[])=ARRAY[format('search_path=%I, pg_catalog, pg_temp',owned_schema)]
              AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN ('${ctrlAfterLf}','${ctrlAfterCrlf}')) THEN
          RAISE EXCEPTION 'Installed cutover guard functions do not match expected rollback profile' USING ERRCODE='23514';
        END IF;
      END $downcheck$;
    `);
    await runner.query(
      'DROP TRIGGER trg_mf06_authority_control_update ON authorization_history_control',
    );
    await runner.query('DROP FUNCTION mf06_authority_control_guard()');
    await runner.query(
      `CREATE OR REPLACE FUNCTION mf06_authority_epoch_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $fn$${PREDECESSOR_EPOCH_GUARD_BODY}$fn$`,
    );
    await runner.query(
      'ALTER TABLE authorization_history_epoch DROP CONSTRAINT chk_authorization_history_activation_time, DROP COLUMN activated_at, DROP COLUMN gapped_at',
    );
    await runner.query(`
      DO $restorecheck$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname='mf06_authority_epoch_guard'
            AND p.prokind='f' AND NOT p.prosecdef AND p.proconfig IS NULL
            AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN ('${epochBeforeLf}','${epochBeforeCrlf}'))
          OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='mf06_authority_control_guard')
          OR EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
            WHERE c.relnamespace=current_schema()::regnamespace AND t.tgname='trg_mf06_authority_control_update')
          OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='authorization_history_epoch'::regclass
            AND attname IN ('activated_at','gapped_at') AND NOT attisdropped) THEN
          RAISE EXCEPTION 'Restored predecessor mf06_authority_epoch_guard profile mismatch' USING ERRCODE='23514';
        END IF;
      END $restorecheck$;
    `);
  }
}

async function ownedSchema(runner: QueryRunner): Promise<string> {
  const [owned]: { name: string }[] = await runner.query('SELECT current_schema() AS name');
  const schema = owned?.name;
  if (
    !schema ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
    schema.startsWith('pg_') ||
    schema === 'information_schema' ||
    schema !== (runner.connection.options as { schema?: string }).schema
  )
    throw new Error('Explicit owned schema required for cutover candidate');
  return schema;
}
