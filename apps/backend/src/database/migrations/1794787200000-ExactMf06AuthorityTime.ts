import type { MigrationInterface, QueryRunner } from 'typeorm';

const effectiveTime = 'COALESCE(req.authority_captured_at,req.captured_at)';
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function scope(runner: QueryRunner): Promise<string> {
  if (!runner.isTransactionActive)
    throw new Error('Exact authority migration requires transaction');
  const [row] = await runner.query('SELECT current_schema() AS name');
  if (
    !row ||
    typeof row.name !== 'string' ||
    !row.name ||
    /^pg_/i.test(row.name) ||
    row.name === 'information_schema'
  )
    throw new Error('Explicit owned application schema required');
  const shadows = await runner.query(`SELECT 1 FROM pg_class
    WHERE relnamespace=pg_my_temp_schema() AND relname IN
    ('ai_observation_event','zone_entry_assessment_request','zone_entry_authority_artifact')`);
  if (shadows.length) throw new Error('Temporary authority storage shadows refused');
  const parents = await runner.query(`SELECT relname FROM pg_catalog.pg_class
    WHERE relnamespace=current_schema()::regnamespace AND relkind='r' AND relname IN
    ('ai_observation_event','zone_entry_assessment_request','zone_entry_authority_artifact')`);
  if (parents.length !== 3) throw new Error('Exact authority parents must belong to target schema');
  await runner.query("SET LOCAL lock_timeout='5s'");
  return row.name;
}

async function replaceArtifactTime(runner: QueryRunner, from: string, to: string) {
  const rows = await runner.query(`SELECT pg_get_functiondef(p.oid) AS body FROM pg_proc p
    WHERE p.pronamespace=current_schema()::regnamespace AND p.proname='mf06_b2_artifact_insert_guard'
    AND p.pronargs=0 AND p.prorettype='trigger'::regtype`);
  if (
    rows.length !== 1 ||
    typeof rows[0]?.body !== 'string' ||
    rows[0].body.split(from).length !== 4
  )
    throw new Error('Unexpected artifact timestamp guard; reviewed upgrade required');
  // Preserve the entire installed guard, including schema/search path and source masks.
  await runner.query(rows[0].body.replaceAll(from, to));
}

/** Exact internal authority binding; legacy capture and existing null semantics remain unchanged. */
export class ExactMf06AuthorityTime1794787200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const schema = await scope(runner);
    const path = `pg_catalog, ${quote(schema)}, pg_temp`;
    await runner.query(
      `LOCK TABLE ${quote(schema)}.zone_entry_assessment_request IN ACCESS EXCLUSIVE MODE`,
    );
    await runner.query(`ALTER TABLE ${quote(schema)}.zone_entry_assessment_request
      ADD COLUMN authority_captured_at timestamptz NULL
      CONSTRAINT chk_mf06_authority_captured_finite CHECK(authority_captured_at IS NULL OR isfinite(authority_captured_at))`);
    await runner.query(`CREATE FUNCTION ${quote(schema)}.mf06_exact_authority_instant(value text)
      RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE STRICT SET search_path TO pg_catalog AS $$
      DECLARE wall timestamptz; fraction integer; offset_text text; minutes integer := 0;
      BEGIN
        IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
          OR left(value,4)='0000' THEN RETURN NULL; END IF;
        wall := (left(value,19) || 'Z')::timestamptz;
        fraction := rpad(coalesce(substring(value FROM '[.]([0-9]+)'),''),6,'0')::integer;
        IF right(value,1)<>'Z' THEN
          offset_text:=right(value,6);
          minutes:=(CASE WHEN left(offset_text,1)='+' THEN 1 ELSE -1 END)*
            (substring(offset_text FROM 2 FOR 2)::integer*60+substring(offset_text FROM 5 FOR 2)::integer);
        END IF;
        RETURN wall + fraction * interval '1 microsecond' - make_interval(mins => minutes);
      EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
        RETURN NULL;
      END $$`);
    await runner.query(`CREATE FUNCTION ${quote(schema)}.mf06_request_authority_time_guard()
      RETURNS trigger LANGUAGE plpgsql SET search_path TO ${path} AS $$
      DECLARE source ai_observation_event%ROWTYPE;
      BEGIN
        IF NEW.authority_captured_at IS NOT NULL THEN
          RAISE EXCEPTION 'Authority capture time is derived by storage' USING ERRCODE='23514';
        END IF;
        SELECT * INTO source FROM ai_observation_event WHERE event_id=NEW.event_id FOR SHARE;
        IF FOUND AND NEW.requested_purpose='INITIAL_OBSERVATION_ASSESSMENT' AND
          NEW.subject_binding_status='BOUND' AND source.admission_context->>'classification'='LIVE' THEN
          NEW.authority_captured_at:=mf06_exact_authority_instant(source.raw_payload->>'capturedAt');
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_request_z_authority_time BEFORE INSERT ON ${quote(schema)}.zone_entry_assessment_request
        FOR EACH ROW EXECUTE FUNCTION ${quote(schema)}.mf06_request_authority_time_guard()`);
    await replaceArtifactTime(runner, 'req.captured_at', effectiveTime);
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = await scope(runner);
    await runner.query(
      `LOCK TABLE ${quote(schema)}.zone_entry_assessment_request IN ACCESS EXCLUSIVE MODE`,
    );
    const [row] =
      await runner.query(`SELECT EXISTS(SELECT 1 FROM ${quote(schema)}.zone_entry_assessment_request
      WHERE authority_captured_at IS NOT NULL) AS populated`);
    if (!row || row.populated !== false)
      throw new Error('Exact authority history must be retained');
    await replaceArtifactTime(runner, effectiveTime, 'req.captured_at');
    await runner.query(`DROP TRIGGER trg_mf06_request_z_authority_time ON ${quote(schema)}.zone_entry_assessment_request;
      DROP FUNCTION ${quote(schema)}.mf06_request_authority_time_guard();
      DROP FUNCTION ${quote(schema)}.mf06_exact_authority_instant(text);
      ALTER TABLE ${quote(schema)}.zone_entry_assessment_request DROP COLUMN authority_captured_at`);
  }
}
