import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ephemeral multi-instance browser camera uplink frame & single-owner lease store.
 * One row per camera, overwritten in place via UPSERT, UNLOGGED to avoid WAL churn,
 * and cleared immediately on stop or ignored once stale (>= 2000ms) / lease expired.
 */
export class CameraBrowserUplinkFrame1795824000000 implements MigrationInterface {
  name = 'CameraBrowserUplinkFrame1795824000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNLOGGED TABLE camera_browser_uplink_frame (
        camera_id uuid PRIMARY KEY REFERENCES camera(id) ON DELETE CASCADE,
        site_id uuid NOT NULL,
        lease_id uuid NOT NULL,
        owner_user_id uuid NOT NULL,
        owner_auth_session_id uuid NOT NULL,
        client_session_id varchar(128) NOT NULL,
        device_label varchar(160),
        state varchar(16) NOT NULL CHECK (state IN ('ACTIVE', 'STOPPED')),
        sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
        width integer CHECK (width IS NULL OR (width >= 64 AND width <= 1280)),
        height integer CHECK (height IS NULL OR (height >= 64 AND height <= 1280)),
        byte_length integer CHECK (byte_length IS NULL OR (byte_length >= 3 AND byte_length <= 256000)),
        captured_at timestamptz,
        lease_expires_at timestamptz NOT NULL,
        stopped_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        jpeg_bytes bytea CHECK (jpeg_bytes IS NULL OR octet_length(jpeg_bytes) <= 256000)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_camera_browser_uplink_site_camera
      ON camera_browser_uplink_frame (site_id, camera_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS camera_browser_uplink_frame');
  }
}
