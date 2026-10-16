import type { MigrationInterface, QueryRunner } from 'typeorm';

export class VisitorRoster1792022400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Historical visits keep their count-only workflow; never invent personal identities.
    await runner.query(`ALTER TABLE visitor_visit ADD COLUMN members jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE visitor_gate_event ADD COLUMN attendees jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE visitor_visit ADD COLUMN email varchar(254), ADD COLUMN language varchar(2) NOT NULL DEFAULT 'en',
        ADD COLUMN booking_code_hash varchar(64), ADD COLUMN booking_code_ciphertext text,
        ADD COLUMN email_status varchar(16) NOT NULL DEFAULT 'NOT_REQUESTED', ADD COLUMN email_attempts integer NOT NULL DEFAULT 0,
        ADD COLUMN email_attempted_at timestamptz, ADD COLUMN email_sent_at timestamptz, ADD COLUMN email_next_attempt_at timestamptz;
      CREATE UNIQUE INDEX uq_visit_booking_code ON visitor_visit(booking_code_hash) WHERE booking_code_hash IS NOT NULL;
      ALTER TABLE visitor_gate_event ADD COLUMN request_hash varchar(64);
      ALTER TABLE visitor_visit ADD CONSTRAINT chk_visit_members CHECK(
        jsonb_typeof(members) = 'array' AND (jsonb_array_length(members) = 0 OR jsonb_array_length(members) = group_size));
      ALTER TABLE visitor_gate_event ADD CONSTRAINT chk_event_attendees CHECK(
        jsonb_typeof(attendees) = 'array' AND (jsonb_array_length(attendees) = 0 OR jsonb_array_length(attendees) = count));`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM visitor_visit WHERE members <> '[]'::jsonb OR booking_code_ciphertext IS NOT NULL)
      OR EXISTS(SELECT 1 FROM visitor_gate_event WHERE attendees <> '[]'::jsonb) THEN
      RAISE EXCEPTION 'Visitor identity history requires the roster schema'; END IF; END $$;
      ALTER TABLE visitor_gate_event DROP CONSTRAINT chk_event_attendees, DROP COLUMN attendees, DROP COLUMN request_hash;
      DROP INDEX uq_visit_booking_code;
      ALTER TABLE visitor_visit DROP CONSTRAINT chk_visit_members, DROP COLUMN members,
        DROP COLUMN email, DROP COLUMN language, DROP COLUMN booking_code_hash, DROP COLUMN booking_code_ciphertext,
        DROP COLUMN email_status, DROP COLUMN email_attempts, DROP COLUMN email_attempted_at, DROP COLUMN email_sent_at, DROP COLUMN email_next_attempt_at;`);
  }
}
