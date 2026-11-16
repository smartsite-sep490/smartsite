import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const trackedCheck = 'chk_ai_event_tracking_fields';
const predecessorSha256 = '59c370b62f0ddd85080e98bcebbb5c72f5a0af5488f79838155d7f04488e0dbe';
const widenedSha256 = '4fe09662a7f23611c1fec1204a2aa722f0944b7756aa4a7929ec68f05fa4d05c';
const trackedV15Check = `CHECK(
        (num_nonnulls(tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,tracking_source_sequence,tracking_part_index,tracking_part_count,tracking_frame_state,tracking_pending_until,tracking_frame_result,tracking_transport_ack)=0) OR (
          num_nonnulls(tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,
            tracking_source_sequence,tracking_part_index,tracking_part_count,tracking_frame_state,
            tracking_pending_until,tracking_transport_ack)=10
          AND resolved_camera_id IS NOT NULL AND tracking_scope_sha256 ~ '^[a-f0-9]{64}$'
          AND tracking_source_sequence BETWEEN 0 AND 18446744073709551615
          AND tracking_part_count BETWEEN 1 AND 1024
          AND tracking_part_index>=0 AND tracking_part_index<tracking_part_count
          AND isfinite(tracking_pending_until)
          AND jsonb_typeof(tracking_transport_ack)='object'
          AND octet_length(tracking_transport_ack::text)<=1048576
          AND (tracking_frame_result IS NULL OR
            (jsonb_typeof(tracking_frame_result)='object' AND octet_length(tracking_frame_result::text)<=1048576))
          AND ((tracking_part_index>0 AND tracking_frame_state IN ('PART_STAGED','PART_EXPIRED') AND tracking_frame_result IS NULL)
            OR (tracking_part_index=0 AND tracking_frame_state IN ('PENDING_PARTS','PENDING_PREDECESSOR') AND tracking_frame_result IS NULL)
            OR (tracking_part_index=0 AND tracking_frame_state IN ('SEALED','REVIEW_ONLY') AND tracking_frame_result IS NOT NULL))
          AND (raw_payload->>'schemaVersion'='1.5.0'
            AND lower(raw_payload->>'eventId')=event_id::text
            AND lower(raw_payload->>'streamSessionId')=stream_session_id::text
            AND raw_payload#>>'{framePartition,frameId}'=tracking_frame_id::text
            AND raw_payload#>>'{framePartition,sequenceNumber}'=tracking_source_sequence::text
            AND raw_payload#>>'{framePartition,partIndex}'=tracking_part_index::text
            AND raw_payload#>>'{framePartition,partCount}'=tracking_part_count::text) IS TRUE
        ) IS TRUE)`;

async function setWireCheck(runner: QueryRunner, raw: string, direction: 'up' | 'down') {
  const [row] = await runner.query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid=$1::regclass AND conname=$2 AND contype='c' AND convalidated`,
    [raw, trackedCheck],
  );
  const expected = direction === 'up' ? predecessorSha256 : widenedSha256;
  if (
    typeof row?.definition !== 'string' ||
    createHash('sha256').update(row.definition).digest('hex') !== expected
  )
    throw new Error('Tracked wire constraint source pin changed');
  const next =
    direction === 'up'
      ? trackedV15Check.replace(
          "raw_payload->>'schemaVersion'='1.5.0'",
          "raw_payload->>'schemaVersion' IN ('1.5.0','1.6.0')",
        )
      : trackedV15Check;
  await runner.query(
    `ALTER TABLE ${raw} DROP CONSTRAINT ${trackedCheck}, ADD CONSTRAINT ${trackedCheck} ${next}`,
  );
}

async function migrate(runner: QueryRunner, direction: 'up' | 'down'): Promise<void> {
  if (!runner.isTransactionActive) throw new Error('Tracked wire migration requires a transaction');
  const [identity] = await runner.query('SELECT current_schema() AS schema');
  if (
    typeof identity?.schema !== 'string' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(identity.schema) ||
    runner.connection.driver.schema !== identity.schema
  )
    throw new Error('Tracked wire migration schema does not match the selected schema');
  const schema = '"' + identity.schema + '"';
  const raw = schema + '.ai_observation_event';
  const generation = schema + '.camera_worker_generation';
  const claim = schema + '.claim_tracked_generation_wire';
  const immutable = schema + '.guard_tracked_generation_wire';
  await runner.query("SET LOCAL lock_timeout='3s'");
  await runner.query("SET LOCAL statement_timeout='15s'");
  await runner.query('LOCK TABLE ' + raw + ',' + generation + ' IN ACCESS EXCLUSIVE MODE');

  if (direction === 'down') {
    const [{ present }] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM ' +
        generation +
        " WHERE tracked_wire_version='1.6.0') AS present",
    );
    if (present) throw new Error('v1.6 generation history must be retained');
    await runner.query('DROP TRIGGER trg_claim_tracked_generation_wire ON ' + raw);
    await runner.query('DROP TRIGGER trg_guard_tracked_generation_wire ON ' + generation);
    await runner.query('DROP FUNCTION ' + claim + '(),' + immutable + '()');
    await runner.query('ALTER TABLE ' + raw + ' DROP CONSTRAINT chk_v16_requires_tracked_route');
    await runner.query('ALTER TABLE ' + generation + ' DROP COLUMN tracked_wire_version');
    await setWireCheck(runner, raw, 'down');
    return;
  }

  const [{ mixed }] = await runner.query(
    'SELECT EXISTS(SELECT 1 FROM ' +
      raw +
      ' WHERE tracking_scope_sha256 IS NOT NULL GROUP BY tracking_generation_id ' +
      "HAVING count(DISTINCT raw_payload->>'schemaVersion')<>1) AS mixed",
  );
  if (mixed) throw new Error('Mixed tracked wire history must be resolved before migration');

  await setWireCheck(runner, raw, 'up');
  await runner.query(
    'ALTER TABLE ' +
      generation +
      ' ADD COLUMN tracked_wire_version text,' +
      ' ADD CONSTRAINT chk_generation_tracked_wire_version CHECK (tracked_wire_version IS NULL OR ' +
      "((observation_route_mode='EPISODE_TRACKED' AND tracked_wire_version IN ('1.5.0','1.6.0')) IS TRUE))",
  );
  await runner.query(
    'UPDATE ' +
      generation +
      ' g SET tracked_wire_version=history.version FROM (' +
      "SELECT tracking_generation_id,min(raw_payload->>'schemaVersion') AS version FROM " +
      raw +
      ' WHERE tracking_scope_sha256 IS NOT NULL GROUP BY tracking_generation_id) history ' +
      'WHERE g.id=history.tracking_generation_id',
  );
  await runner.query(
    'ALTER TABLE ' +
      raw +
      ' ADD CONSTRAINT chk_v16_requires_tracked_route ' +
      "CHECK (raw_payload->>'schemaVersion' IS DISTINCT FROM '1.6.0' OR tracking_scope_sha256 IS NOT NULL)",
  );

  await runner.query(
    'CREATE FUNCTION ' +
      immutable +
      '() RETURNS trigger LANGUAGE plpgsql AS $$ ' +
      'BEGIN IF OLD.tracked_wire_version IS NOT NULL AND NEW.tracked_wire_version IS DISTINCT FROM OLD.tracked_wire_version THEN ' +
      "RAISE EXCEPTION 'Tracked generation wire version is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$",
  );
  await runner.query(
    'CREATE TRIGGER trg_guard_tracked_generation_wire BEFORE UPDATE OF tracked_wire_version ON ' +
      generation +
      ' FOR EACH ROW EXECUTE FUNCTION ' +
      immutable +
      '()',
  );

  await runner.query(
    'CREATE FUNCTION ' +
      claim +
      '() RETURNS trigger LANGUAGE plpgsql AS $$ ' +
      "DECLARE wanted text := NEW.raw_payload->>'schemaVersion'; stored text; " +
      'BEGIN UPDATE ' +
      generation +
      ' SET tracked_wire_version=wanted WHERE id=NEW.tracking_generation_id ' +
      'AND camera_id=NEW.resolved_camera_id AND site_id=NEW.tracking_site_id AND stream_session_id=NEW.stream_session_id ' +
      "AND observation_route_mode='EPISODE_TRACKED' AND tracked_wire_version IS NULL; " +
      'SELECT tracked_wire_version INTO stored FROM ' +
      generation +
      ' WHERE id=NEW.tracking_generation_id ' +
      'AND camera_id=NEW.resolved_camera_id AND site_id=NEW.tracking_site_id AND stream_session_id=NEW.stream_session_id FOR UPDATE; ' +
      'IF NOT FOUND OR stored IS DISTINCT FROM wanted THEN ' +
      "RAISE EXCEPTION 'Tracked generation wire version mismatch' USING ERRCODE='23514', CONSTRAINT='chk_generation_tracked_wire_version'; " +
      'END IF; RETURN NULL; END $$',
  );
  await runner.query(
    'CREATE TRIGGER trg_claim_tracked_generation_wire AFTER INSERT ON ' +
      raw +
      ' FOR EACH ROW WHEN (NEW.tracking_scope_sha256 IS NOT NULL) EXECUTE FUNCTION ' +
      claim +
      '()',
  );
}

export class TrackedWireGenerationFence1795046400008 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await migrate(runner, 'up');
  }

  async down(runner: QueryRunner): Promise<void> {
    await migrate(runner, 'down');
  }
}
