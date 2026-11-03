import type { MigrationInterface, QueryRunner } from 'typeorm';
import { lockCleanupTables } from './erd-cleanup-scope.js';

export class MergeVisitorGateEvents1794960000003 implements MigrationInterface {
  name = 'MergeVisitorGateEvents1794960000003';
  async up(runner: QueryRunner): Promise<void> {
    const table = await lockCleanupTables(runner, [
      'gate_event',
      'visitor_gate_event',
      'visitor_visit',
      'access_attempt',
    ]);
    const [row] = (await runner.query(`SELECT count(*)::text AS count
      FROM ${table('visitor_gate_event')} v FULL JOIN ${table('gate_event')} g ON g.id=v.id
      LEFT JOIN ${table('visitor_visit')} visit ON visit.id=COALESCE(v.visit_id,g.visit_id)
      LEFT JOIN ${table('access_attempt')} a ON a.id=g.access_attempt_id
      WHERE (v.id IS NOT NULL OR g.visit_id IS NOT NULL) AND (
        v.id IS NULL OR g.id IS NULL OR visit.id IS NULL OR a.id IS NULL OR g.worker_id IS NOT NULL
        OR g.visit_id IS DISTINCT FROM v.visit_id OR g.site_id IS DISTINCT FROM visit.site_id
        OR g.direction IS DISTINCT FROM v.direction OR g.gate_name IS DISTINCT FROM v.gate_id
        OR g.recorded_by IS DISTINCT FROM v.operator_user_id
        OR a.site_id IS DISTINCT FROM g.site_id OR a.visit_id IS DISTINCT FROM v.visit_id
        OR a.worker_id IS NOT NULL OR a.operator_id IS DISTINCT FROM v.operator_user_id
        OR a.gate_id IS DISTINCT FROM v.gate_id OR a.direction IS DISTINCT FROM v.direction
        OR a.status<>'USED' OR a.identity_status<>'MATCHED' OR a.authorization_status<>'ALLOWED'
        OR NOT isfinite(v.created_at) OR (v.request_hash IS NOT NULL AND v.request_hash !~ '^[0-9a-f]{64}$')
      )`)) as { count: string }[];
    if (row!.count !== '0')
      throw new Error(`Visitor event reconciliation required for ${row!.count} rows`);
    await runner.query(`ALTER TABLE ${table('gate_event')}
      ADD COLUMN count integer, ADD COLUMN attendees jsonb, ADD COLUMN request_hash varchar(64),
      ADD COLUMN visitor_event_created_at timestamptz;
      UPDATE ${table('gate_event')} g SET count=v.count,attendees=v.attendees,request_hash=v.request_hash,
        visitor_event_created_at=v.created_at FROM ${table('visitor_gate_event')} v WHERE v.id=g.id;
      ALTER TABLE ${table('gate_event')} ADD CONSTRAINT ck_gate_event_visitor_data CHECK (
        (worker_id IS NOT NULL AND count IS NULL AND attendees IS NULL AND request_hash IS NULL AND visitor_event_created_at IS NULL)
        OR (visit_id IS NOT NULL AND count IS NOT NULL AND count>0 AND attendees IS NOT NULL
          AND jsonb_typeof(attendees)='array' AND (jsonb_array_length(attendees)=0 OR jsonb_array_length(attendees)=count)
          AND recorded_by IS NOT NULL AND visitor_event_created_at IS NOT NULL AND isfinite(visitor_event_created_at)
          AND (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')));
      CREATE INDEX idx_gate_event_visitor_history ON ${table('gate_event')}(site_id,visitor_event_created_at,id) WHERE visit_id IS NOT NULL;
      DROP TABLE ${table('visitor_gate_event')}`);
  }
  async down(): Promise<void> {
    throw new Error('Merged visitor history cannot be safely split; restore a backup');
  }
}
