import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

// Immutable predecessor check copied locally so published migration0008 stays unchanged.
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

const versionChecks = [
  {
    table: 'ai_observation_event',
    name: 'chk_ai_event_tracking_fields',
    v16: '4fe09662a7f23611c1fec1204a2aa722f0944b7756aa4a7929ec68f05fa4d05c',
    v17: '6f578c9510650ce74e507049f73fca5631d56d1821df7de612eb1f217b8b6fac',
  },
  {
    table: 'camera_worker_generation',
    name: 'chk_generation_tracked_wire_version',
    v16: '8e31c8279ff93c5813ea2513f62697c6c816884e53d52f454a1c01d267dd26f8',
    v17: '132aec098458b30551465815ae6b20ff866e7ca9f0a56d7b02a6f21ff8168549',
  },
] as const;

const v16 = "'1.6.0'::text";
const v17Tail = ", '1.7.0'::text";
const routeCheck = 'chk_v17_requires_tracked_route';

async function migrate(runner: QueryRunner, forward: boolean) {
  if (!runner.isTransactionActive)
    throw new Error('Tracked camera PPE migration requires a transaction');
  const [{ schema }] = await runner.query('SELECT current_schema() AS schema');
  if (
    typeof schema !== 'string' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
    runner.connection.driver.schema !== schema
  ) {
    throw new Error('Tracked camera PPE requires the selected schema');
  }

  const raw = '"' + schema + '".ai_observation_event';
  const generation = '"' + schema + '".camera_worker_generation';
  await runner.query("SET LOCAL lock_timeout='3s'");
  await runner.query("SET LOCAL statement_timeout='15s'");
  await runner.query('LOCK TABLE ' + raw + ',' + generation + ' IN ACCESS EXCLUSIVE MODE');

  if (!forward) {
    const [{ present }] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM ' +
        generation +
        " WHERE tracked_wire_version='1.7.0') OR " +
        'EXISTS(SELECT 1 FROM ' +
        raw +
        " WHERE raw_payload->>'schemaVersion'='1.7.0') AS present",
    );
    if (present) throw new Error('v1.7 tracked history must be retained');
  }

  for (const check of versionChecks) {
    const table = '"' + schema + '".' + check.table;
    const [row] = await runner.query(
      'SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint ' +
        "WHERE conrelid=$1::regclass AND conname=$2 AND contype='c' AND convalidated",
      [table, check.name],
    );
    const definition: unknown = row?.definition;
    if (typeof definition !== 'string') throw new Error('Tracked wire check is missing');
    const expected = forward ? check.v16 : check.v17;
    if (createHash('sha256').update(definition).digest('hex') !== expected)
      throw new Error('Tracked camera PPE constraint source pin changed');

    const next = forward
      ? definition.replace(v16, v16 + v17Tail)
      : check.table === 'ai_observation_event'
        ? trackedV15Check.replace(
            "raw_payload->>'schemaVersion'='1.5.0'",
            "raw_payload->>'schemaVersion' IN ('1.5.0','1.6.0')",
          )
        : definition.replace(v16 + v17Tail, v16);
    if (next === definition) throw new Error('Tracked wire check could not be updated');
    await runner.query(
      'ALTER TABLE ' +
        table +
        ' DROP CONSTRAINT ' +
        check.name +
        ', ADD CONSTRAINT ' +
        check.name +
        ' ' +
        next,
    );
  }

  await runner.query(
    forward
      ? 'ALTER TABLE ' +
          raw +
          ' ADD CONSTRAINT ' +
          routeCheck +
          " CHECK (raw_payload->>'schemaVersion' IS DISTINCT FROM '1.7.0' OR tracking_scope_sha256 IS NOT NULL)"
      : 'ALTER TABLE ' + raw + ' DROP CONSTRAINT ' + routeCheck,
  );
}

export class TrackedCameraPpeWire1795046400011 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await migrate(runner, true);
  }

  async down(runner: QueryRunner): Promise<void> {
    await migrate(runner, false);
  }
}
