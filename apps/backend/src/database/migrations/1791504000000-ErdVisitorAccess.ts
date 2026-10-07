import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ErdVisitorAccess1791504000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE visitor (
        id uuid PRIMARY KEY, full_name varchar(255) NOT NULL, contact varchar(255) NOT NULL,
        organization varchar(255) NOT NULL, identity_reference varchar(200),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO visitor(id,full_name,contact,organization,created_at)
        SELECT id,visitor_name,contact,company,created_at FROM visitor_visit;
      ALTER TABLE visitor_visit
        ADD COLUMN representative_visitor_id uuid CONSTRAINT fk_visit_representative REFERENCES visitor(id) ON DELETE RESTRICT,
        ADD COLUMN site_manager_id uuid CONSTRAINT fk_visit_site_manager REFERENCES app_user(id) ON DELETE RESTRICT,
        ADD COLUMN version integer NOT NULL DEFAULT 1 CONSTRAINT chk_visit_version CHECK(version >= 1),
        ADD COLUMN review_note text,
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      UPDATE visitor_visit v SET representative_visitor_id=v.id,
        site_manager_id=COALESCE((SELECT r.user_id FROM user_role_assignment r WHERE r.user_id=v.decided_by_user_id AND r.site_id=v.site_id AND r.role='SITE_MANAGER' LIMIT 1),(SELECT r.user_id FROM user_role_assignment r
          WHERE r.site_id=v.site_id AND r.role='SITE_MANAGER' ORDER BY r.created_at,r.id LIMIT 1));
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM visitor_visit WHERE site_manager_id IS NULL) THEN
          RAISE EXCEPTION 'Assign a Site Manager to every site with legacy visits before migrating';
        END IF;
      END $$;
      ALTER TABLE visitor_visit ALTER COLUMN representative_visitor_id SET NOT NULL,
        ALTER COLUMN site_manager_id SET NOT NULL,
        DROP CONSTRAINT chk_visit_status, DROP CONSTRAINT chk_visit_counts,
        ADD CONSTRAINT chk_visit_status CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
        ADD CONSTRAINT chk_visit_counts CHECK(entered_count>=0 AND exited_count>=0 AND exited_count<=entered_count
          AND entered_count-exited_count<=group_size);
      CREATE TABLE visit_zone (
        id uuid PRIMARY KEY,
        visit_id uuid NOT NULL CONSTRAINT fk_visit_zone_visit REFERENCES visitor_visit(id) ON DELETE CASCADE,
        zone_id uuid NOT NULL CONSTRAINT fk_visit_zone_zone REFERENCES zone(id) ON DELETE RESTRICT,
        valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_visit_zone_interval CHECK(valid_until>valid_from)
      );
      CREATE UNIQUE INDEX uq_visit_zone_interval ON visit_zone(visit_id,zone_id,valid_from);
      ALTER TABLE qr_credential
        ADD COLUMN site_id uuid CONSTRAINT fk_qr_site REFERENCES site(id) ON DELETE RESTRICT,
        ADD COLUMN direction varchar(3) CONSTRAINT chk_qr_direction CHECK(direction IS NULL OR direction IN ('IN','OUT')),
        ADD COLUMN revoked_at timestamptz;
      UPDATE qr_credential q SET site_id=COALESCE(
        (SELECT site_id FROM visitor_visit v WHERE v.id=q.visit_id),
        (SELECT site_id FROM qr_fallback_session f WHERE f.id=q.fallback_session_id)),
        direction=(SELECT direction FROM qr_fallback_session f WHERE f.id=q.fallback_session_id);
      UPDATE qr_credential SET revoked_at=now() WHERE consumed_at IS NULL;
      ALTER TABLE worker_site_zone_assignment
        ADD COLUMN site_contractor_id uuid CONSTRAINT fk_assignment_participation REFERENCES contractor_site_participation(id) ON DELETE RESTRICT,
        ADD COLUMN version integer NOT NULL DEFAULT 1,
        ADD COLUMN reviewed_at timestamptz,
        ADD COLUMN review_note text;
      UPDATE worker_site_zone_assignment a SET site_contractor_id=(SELECT p.id FROM contractor_site_participation p
        JOIN worker w ON w.contractor_id=p.contractor_id WHERE w.id=a.worker_id AND p.site_id=a.site_id
        ORDER BY p.created_at,p.id LIMIT 1);
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    // Re-entry and new visit lifecycles cannot be represented safely by the previous schema.
    await runner.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM visitor_visit WHERE entered_count>group_size OR status IN ('CANCELLED','EXPIRED'))
        OR EXISTS(SELECT 1 FROM visit_zone) THEN
        RAISE EXCEPTION 'Visitor history requires the ERD access schema; downgrade refused';
      END IF;
    END $$;
    ALTER TABLE worker_site_zone_assignment DROP COLUMN site_contractor_id,DROP COLUMN version,DROP COLUMN reviewed_at,DROP COLUMN review_note;
    ALTER TABLE qr_credential DROP COLUMN site_id,DROP COLUMN direction,DROP COLUMN revoked_at;
    DROP TABLE visit_zone;
    ALTER TABLE visitor_visit DROP COLUMN representative_visitor_id,DROP COLUMN site_manager_id,
      DROP COLUMN version,DROP COLUMN review_note,DROP COLUMN updated_at,
      DROP CONSTRAINT chk_visit_status,DROP CONSTRAINT chk_visit_counts,
      ADD CONSTRAINT chk_visit_status CHECK(status IN ('PENDING','APPROVED','REJECTED')),
      ADD CONSTRAINT chk_visit_counts CHECK(entered_count>=0 AND entered_count<=group_size
        AND exited_count>=0 AND exited_count<=entered_count);
    DROP TABLE visitor;`);
  }
}
