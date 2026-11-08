import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Unregistered companion to tracked storage. Index only coordinators that recovery can select. */
export class TrackedPendingRecoveryIndex1795046400004 implements MigrationInterface {
  name = 'TrackedPendingRecoveryIndex1795046400004';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`CREATE INDEX idx_ai_tracking_pending_coordinator ON ai_observation_event
      (resolved_camera_id,tracking_generation_id,stream_session_id,tracking_source_sequence,event_id)
      INCLUDE (tracking_frame_id)
      WHERE tracking_part_index=0 AND tracking_frame_state IN ('PENDING_PARTS','PENDING_PREDECESSOR')`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('DROP INDEX idx_ai_tracking_pending_coordinator');
  }
}
