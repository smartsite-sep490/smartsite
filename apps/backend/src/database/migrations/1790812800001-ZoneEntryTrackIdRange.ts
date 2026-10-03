import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ZoneEntryTrackIdRange1790812800001 implements MigrationInterface {
  name = 'ZoneEntryTrackIdRange1790812800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE zone_entry_decision
        ALTER COLUMN track_id TYPE bigint USING track_id::bigint,
        ADD CONSTRAINT chk_zone_entry_decision_track_id
          CHECK (track_id BETWEEN 0 AND 9007199254740991)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // One atomic statement: PostgreSQL refuses out-of-range INTEGER casts.
    // Never clamp IDs, delete decisions, or leave the range constraint removed on failure.
    await queryRunner.query(`
      ALTER TABLE zone_entry_decision
        ALTER COLUMN track_id TYPE integer USING track_id::integer,
        DROP CONSTRAINT chk_zone_entry_decision_track_id
    `);
  }
}
