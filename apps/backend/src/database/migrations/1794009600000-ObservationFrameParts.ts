import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ObservationFrameParts1794009600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE UNIQUE INDEX uq_ai_event_frame_part
      ON ai_observation_event(resolved_camera_id,stream_session_id,
        (raw_payload#>>'{framePartition,frameId}'),(raw_payload#>'{framePartition,partIndex}'))
      WHERE raw_payload->>'schemaVersion'='1.4.0'`);
    await runner.query(`CREATE INDEX idx_ai_event_source_frame
      ON ai_observation_event(resolved_camera_id,stream_session_id,
        (raw_payload#>>'{framePartition,sequenceNumber}'))
      WHERE raw_payload->>'schemaVersion'='1.4.0'`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX uq_ai_event_frame_part');
    await runner.query('DROP INDEX idx_ai_event_source_frame');
  }
}
