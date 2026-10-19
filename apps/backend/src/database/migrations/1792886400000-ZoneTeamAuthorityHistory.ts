import type { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen additive input masks; do not import the evolving runtime registry here.
const sources = [
  ['TEAM', 'contractor_team', ['id', 'site_id', 'contractor_id', 'is_active']],
  [
    'TEAM_MEMBERSHIP',
    'contractor_team_membership',
    ['id', 'team_id', 'worker_id', 'site_id', 'contractor_id', 'joined_at', 'left_at'],
  ],
  [
    'TEAM_PERMISSION',
    'team_zone_permission',
    ['id', 'team_id', 'contractor_zone_permission_id', 'valid_from', 'valid_until', 'revoked_at'],
  ],
  [
    'ASSIGNMENT',
    'worker_site_zone_assignment',
    [
      'id',
      'worker_id',
      'site_id',
      'site_contractor_id',
      'status',
      'version',
      'valid_from',
      'valid_until',
      'zone_ids',
    ],
  ],
] as const;

/** Unregistered candidate: append-only V2 inputs, not an epoch/cutover or worker. */
export class ZoneTeamAuthorityHistory1792886400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw Error('Team authority migration requires a transaction');
    const rows: { name: string }[] = await runner.query(`SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r'
      AND c.relname IN ('mf06_authority_command','authorization_history_command')`);
    if (rows.length !== 1) throw Error('Team authority requires one qualified command namespace');
    const command = rows[0]!.name;
    await runner.query("SET LOCAL lock_timeout='3s'");
    await runner.query("SET LOCAL statement_timeout='5s'");
    await runner.query(
      `LOCK TABLE ${sources.map(([, table]) => table).join(',')} IN SHARE ROW EXCLUSIVE MODE`,
    );
    let seedRows = 0,
      seedBytes = 0n;
    for (const [, table, fields] of sources) {
      const [budget]: { n: number; bytes: string }[] = await runner.query(
        `SELECT count(*)::int AS n,COALESCE(sum(octet_length(payload::text)),0)::text AS bytes
         FROM (SELECT (SELECT jsonb_object_agg(k,to_jsonb(t)->k) FROM unnest($1::text[]) k) AS payload
           FROM ${table} t LIMIT 2049) seed_rows`,
        [[...fields]],
      );
      if (!budget) throw Error('Team authority seed budget unavailable');
      seedRows += budget.n;
      seedBytes += BigInt(budget.bytes);
      if (seedRows > 2048 || seedBytes > 2097152n)
        throw Error('Team authority seed exceeds bounded history limits');
    }
    await runner.query(`
      CREATE TABLE zone_team_authority_head (
        source_kind TEXT NOT NULL, source_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision>=0),
        after_payload JSONB, PRIMARY KEY(source_kind,source_id)
      );
      CREATE TABLE zone_team_authority_revision (
        fact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_kind TEXT NOT NULL,
        source_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision>0),
        command_id UUID REFERENCES ${command}(command_id) ON DELETE RESTRICT,
        transaction_id XID8 NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
        before_payload JSONB,after_payload JSONB,before_hash CHAR(64),after_hash CHAR(64),
        hash_algorithm TEXT NOT NULL CHECK(hash_algorithm='POSTGRES_JSONB_TEXT_SHA256_V1'),
        UNIQUE(source_kind,source_id,revision)
      );
      CREATE INDEX idx_zone_team_revision_time ON zone_team_authority_revision(observed_at);
      CREATE INDEX idx_zone_team_revision_command ON zone_team_authority_revision(command_id);
      CREATE TABLE zone_team_authority_gap (
        gap_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_kind TEXT NOT NULL,source_id UUID,
        transaction_id XID8 NOT NULL,observed_at TIMESTAMPTZ NOT NULL,reason TEXT NOT NULL
          CHECK(reason IN ('UNATTRIBUTED_WRITE','SOURCE_HEAD_MISMATCH','UNCOVERED_TRUNCATE','RESOURCE_LIMIT'))
      );
      CREATE INDEX idx_zone_team_gap_time ON zone_team_authority_gap(observed_at);
      CREATE FUNCTION zone_team_authority_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Team authority history is immutable' USING ERRCODE='23514';END $$;
      CREATE FUNCTION zone_team_authority_internal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Team authority journal is source owned' USING ERRCODE='23514';END IF;
        RETURN NEW;
      END $$;
    `);
    // These revision-zero heads describe migration-time state only, never past authority.
    for (const [kind, table, fields] of sources) {
      await runner.query(
        `INSERT INTO zone_team_authority_head(source_kind,source_id,revision,after_payload)
        SELECT $1,t.id,0,(SELECT jsonb_object_agg(k,to_jsonb(t)->k) FROM unnest($2::text[]) k) FROM ${table} t`,
        [kind, [...fields]],
      );
    }
    const cases = sources
      .map(
        ([kind, table, fields]) =>
          `WHEN kind='${kind}' AND TG_TABLE_NAME='${table}' THEN keys:=ARRAY[${fields.map((f) => `'${f}'`).join(',')}];`,
      )
      .join('\n');
    await runner.query(`
      CREATE FUNCTION zone_team_authority_capture() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
      DECLARE kind TEXT:=TG_ARGV[0];keys TEXT[];prior JSONB;following JSONB;sid UUID;
        old_head JSONB;head_found BOOLEAN;rev BIGINT;cmd UUID;cmd_text TEXT;gap_reason TEXT;
      BEGIN
        CASE ${cases} ELSE RAISE EXCEPTION 'Team authority source mismatch' USING ERRCODE='23514';END CASE;
        IF TG_OP='TRUNCATE' THEN
          INSERT INTO zone_team_authority_gap(source_kind,transaction_id,observed_at,reason)
            VALUES(kind,pg_current_xact_id(),clock_timestamp(),'UNCOVERED_TRUNCATE');RETURN NULL;
        END IF;
        IF TG_OP<>'INSERT' THEN SELECT jsonb_object_agg(k,to_jsonb(OLD)->k) INTO prior FROM unnest(keys) k;END IF;
        IF TG_OP<>'DELETE' THEN SELECT jsonb_object_agg(k,to_jsonb(NEW)->k) INTO following FROM unnest(keys) k;END IF;
        IF prior IS NOT DISTINCT FROM following THEN RETURN NULL;END IF;
        sid:=(COALESCE(following,prior)->>'id')::uuid;
        IF COALESCE(octet_length(prior::text),0)+COALESCE(octet_length(following::text),0)>2097152 THEN
          INSERT INTO zone_team_authority_gap(source_kind,source_id,transaction_id,observed_at,reason)
            VALUES(kind,sid,pg_current_xact_id(),clock_timestamp(),'RESOURCE_LIMIT');RETURN NULL;
        END IF;
        cmd_text:=current_setting('smartsite.mf06_command_id',true);
        IF cmd_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
          SELECT command_id INTO cmd FROM ${command} WHERE command_id=cmd_text::uuid AND transaction_id=pg_current_xact_id();
        END IF;
        IF cmd IS NULL THEN gap_reason:='UNATTRIBUTED_WRITE';END IF;
        SELECT after_payload INTO old_head FROM zone_team_authority_head WHERE source_kind=kind AND source_id=sid FOR UPDATE;
        head_found:=FOUND;
        IF (head_found AND old_head IS DISTINCT FROM prior) OR (NOT head_found AND prior IS NOT NULL) THEN
          gap_reason:='SOURCE_HEAD_MISMATCH';END IF;
        INSERT INTO zone_team_authority_head(source_kind,source_id,revision,after_payload) VALUES(kind,sid,1,following)
          ON CONFLICT(source_kind,source_id) DO UPDATE SET revision=zone_team_authority_head.revision+1,after_payload=EXCLUDED.after_payload
          RETURNING revision INTO rev;
        INSERT INTO zone_team_authority_revision(source_kind,source_id,revision,command_id,transaction_id,observed_at,
          operation,before_payload,after_payload,before_hash,after_hash,hash_algorithm)
          VALUES(kind,sid,rev,cmd,pg_current_xact_id(),clock_timestamp(),TG_OP,prior,following,
            CASE WHEN prior IS NOT NULL THEN encode(sha256(convert_to(prior::text,'UTF8')),'hex') END,
            CASE WHEN following IS NOT NULL THEN encode(sha256(convert_to(following::text,'UTF8')),'hex') END,
            'POSTGRES_JSONB_TEXT_SHA256_V1');
        IF gap_reason IS NOT NULL THEN INSERT INTO zone_team_authority_gap(source_kind,source_id,transaction_id,observed_at,reason)
          VALUES(kind,sid,pg_current_xact_id(),clock_timestamp(),gap_reason);END IF;
        RETURN NULL;
      END $$;
    `);
    for (const [kind, table] of sources)
      await runner.query(`
      CREATE TRIGGER trg_zone_team_capture_${table} AFTER INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION zone_team_authority_capture('${kind}');
      CREATE TRIGGER trg_zone_team_truncate_${table} AFTER TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION zone_team_authority_capture('${kind}');`);
    for (const table of [
      'zone_team_authority_head',
      'zone_team_authority_revision',
      'zone_team_authority_gap',
    ]) {
      await runner.query(`CREATE TRIGGER trg_${table}_write BEFORE INSERT ${table.endsWith('_head') ? 'OR UPDATE' : ''} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION zone_team_authority_internal();
        CREATE TRIGGER trg_${table}_delete BEFORE DELETE ${table.endsWith('_head') ? '' : 'OR UPDATE'} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION zone_team_authority_immutable();
        CREATE TRIGGER trg_${table}_truncate BEFORE TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION zone_team_authority_immutable();`);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw Error('Team authority migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='3s'");
    await runner.query(
      `LOCK TABLE ${sources.map(([, table]) => table).join(',')} IN SHARE ROW EXCLUSIVE MODE`,
    );
    await runner.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM zone_team_authority_revision) OR EXISTS(SELECT 1 FROM zone_team_authority_gap) THEN
        RAISE EXCEPTION 'Downgrade refused: team authority history must be preserved';END IF;END $$;`);
    for (const [, table] of sources)
      await runner.query(`DROP TRIGGER trg_zone_team_capture_${table} ON ${table};
      DROP TRIGGER trg_zone_team_truncate_${table} ON ${table};`);
    await runner.query(`DROP TABLE zone_team_authority_gap,zone_team_authority_revision,zone_team_authority_head;
      DROP FUNCTION zone_team_authority_capture(),zone_team_authority_internal(),zone_team_authority_immutable();`);
  }
}
