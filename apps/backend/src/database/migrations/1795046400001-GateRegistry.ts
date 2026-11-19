import type { MigrationInterface, QueryRunner } from 'typeorm';
import { lockCleanupTables } from './erd-cleanup-scope.js';

/** Retain proven Zone cameras; never erase or guess legacy Gate bindings. */
export class GateRegistry1795046400001 implements MigrationInterface {
  name = 'GateRegistry1795046400001';
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Gate registry migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await lockCleanupTables(runner, [
      'camera',
      'camera_observation_region',
      'zone',
      'access_attempt',
      'gate_access_log',
      'visitor_visit',
      'qr_fallback_session',
    ]);
    await runner.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM access_attempt)
        OR EXISTS(SELECT 1 FROM gate_access_log) OR EXISTS(SELECT 1 FROM visitor_visit)
        OR EXISTS(SELECT 1 FROM qr_fallback_session) THEN
        RAISE EXCEPTION 'GateRegistry requires an explicit migration plan for legacy Gate history; existing data is not converted or deleted';
      END IF;
      IF EXISTS(SELECT 1 FROM camera c WHERE NOT EXISTS
        (SELECT 1 FROM camera_observation_region r WHERE r.camera_id=c.id)) THEN
        RAISE EXCEPTION 'GateRegistry cannot classify a legacy Camera without an observation Region; an explicit mapping is required';
      END IF;
      IF EXISTS(SELECT 1 FROM camera_observation_region r
        LEFT JOIN camera c ON c.id=r.camera_id LEFT JOIN zone z ON z.id=r.zone_id
        WHERE c.id IS NULL OR z.id IS NULL OR c.site_id<>z.site_id) THEN
        RAISE EXCEPTION 'GateRegistry refuses invalid Camera/Region/Zone Site bindings';
      END IF;
    END $$;
    CREATE TABLE gate (
      id uuid CONSTRAINT pk_gate_id PRIMARY KEY, site_id uuid NOT NULL, code varchar(64) NOT NULL,
      name varchar(100) NOT NULL, status varchar(8) NOT NULL DEFAULT 'ACTIVE',
      CONSTRAINT uq_gate_id_site UNIQUE(id,site_id),
      CONSTRAINT uq_gate_site_code UNIQUE(site_id,code),
      CONSTRAINT fk_gate_site FOREIGN KEY(site_id) REFERENCES site(id) ON DELETE RESTRICT,
      CONSTRAINT ck_gate_status CHECK(status IN ('ACTIVE','INACTIVE'))
    );
    ALTER TABLE camera ADD COLUMN type varchar(4), ADD COLUMN gate_id uuid;
    UPDATE camera SET type='ZONE';
    ALTER TABLE camera ALTER COLUMN type SET NOT NULL,
      ADD CONSTRAINT uq_camera_source_gate_site UNIQUE(id,gate_id,site_id),
      ADD CONSTRAINT ck_camera_purpose CHECK((type='GATE' AND gate_id IS NOT NULL) OR (type='ZONE' AND gate_id IS NULL)),
      ADD CONSTRAINT fk_camera_gate_site FOREIGN KEY(gate_id,site_id) REFERENCES gate(id,site_id) ON DELETE RESTRICT;
    ALTER TABLE camera_observation_region ADD COLUMN site_id uuid;
    UPDATE camera_observation_region r SET site_id=c.site_id FROM camera c WHERE c.id=r.camera_id;
    ALTER TABLE camera_observation_region ALTER COLUMN site_id SET NOT NULL,
      ADD CONSTRAINT fk_region_camera_site FOREIGN KEY(camera_id,site_id) REFERENCES camera(id,site_id) ON DELETE RESTRICT,
      ADD CONSTRAINT fk_region_zone_site FOREIGN KEY(zone_id,site_id) REFERENCES zone(id,site_id) ON DELETE RESTRICT;
    ALTER TABLE access_attempt ALTER COLUMN gate_id TYPE uuid USING gate_id::uuid,
      ADD COLUMN source_camera_id uuid,
      ADD CONSTRAINT fk_attempt_gate_site FOREIGN KEY(gate_id,site_id) REFERENCES gate(id,site_id) ON DELETE RESTRICT,
      ADD CONSTRAINT fk_attempt_source_camera FOREIGN KEY(source_camera_id,gate_id,site_id) REFERENCES camera(id,gate_id,site_id) ON DELETE RESTRICT,
      ADD CONSTRAINT ck_attempt_face_source CHECK(method<>'FACE' OR source_camera_id IS NOT NULL);
    ALTER TABLE gate_access_log ALTER COLUMN gate_id TYPE uuid USING gate_id::uuid,
      ADD CONSTRAINT fk_gate_log_gate_site FOREIGN KEY(gate_id,site_id) REFERENCES gate(id,site_id) ON DELETE RESTRICT;
    ALTER TABLE visitor_visit ALTER COLUMN gate_id TYPE uuid USING gate_id::uuid,
      ADD CONSTRAINT fk_visit_gate_site FOREIGN KEY(gate_id,site_id) REFERENCES gate(id,site_id) ON DELETE RESTRICT;
    ALTER TABLE qr_fallback_session ALTER COLUMN gate_id TYPE uuid USING gate_id::uuid,
      ADD CONSTRAINT fk_fallback_gate_site FOREIGN KEY(gate_id,site_id) REFERENCES gate(id,site_id) ON DELETE RESTRICT;
    CREATE FUNCTION gate_registry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_TABLE_NAME='gate' THEN
        IF NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.code IS DISTINCT FROM OLD.code THEN
          RAISE EXCEPTION 'Gate Site and code are immutable' USING ERRCODE='23514'; END IF;
      ELSE
        IF NEW.type IS DISTINCT FROM OLD.type OR NEW.gate_id IS DISTINCT FROM OLD.gate_id THEN
          RAISE EXCEPTION 'Camera purpose and Gate binding are immutable' USING ERRCODE='23514'; END IF;
      END IF; RETURN NEW; END $$;
    CREATE TRIGGER gate_registry_immutable BEFORE UPDATE ON gate FOR EACH ROW EXECUTE FUNCTION gate_registry_immutable();
    CREATE TRIGGER camera_gate_immutable BEFORE UPDATE ON camera FOR EACH ROW EXECUTE FUNCTION gate_registry_immutable();
    CREATE FUNCTION gate_registry_region() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM camera WHERE id=NEW.camera_id AND site_id=NEW.site_id AND type='ZONE') THEN
        RAISE EXCEPTION 'Observation Regions require a ZONE Camera in the same Site' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER region_zone_camera BEFORE INSERT OR UPDATE ON camera_observation_region FOR EACH ROW EXECUTE FUNCTION gate_registry_region();`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Gate registry migration requires a transaction');
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM gate) OR EXISTS(SELECT 1 FROM camera) THEN
      RAISE EXCEPTION 'Gate history cannot be downgraded safely; restore a backup or use a forward migration'; END IF; END $$;
      DROP TRIGGER region_zone_camera ON camera_observation_region;
      DROP FUNCTION gate_registry_region();
      DROP TRIGGER camera_gate_immutable ON camera;
      DROP TRIGGER gate_registry_immutable ON gate;
      DROP FUNCTION gate_registry_immutable();
      ALTER TABLE access_attempt DROP CONSTRAINT fk_attempt_source_camera, DROP CONSTRAINT ck_attempt_face_source,
        DROP CONSTRAINT fk_attempt_gate_site, DROP COLUMN source_camera_id, ALTER COLUMN gate_id TYPE varchar(64) USING gate_id::text;
      ALTER TABLE gate_access_log DROP CONSTRAINT fk_gate_log_gate_site, ALTER COLUMN gate_id TYPE varchar(64) USING gate_id::text;
      ALTER TABLE visitor_visit DROP CONSTRAINT fk_visit_gate_site, ALTER COLUMN gate_id TYPE varchar(64) USING gate_id::text;
      ALTER TABLE qr_fallback_session DROP CONSTRAINT fk_fallback_gate_site, ALTER COLUMN gate_id TYPE varchar(64) USING gate_id::text;
      ALTER TABLE camera_observation_region DROP CONSTRAINT fk_region_camera_site, DROP CONSTRAINT fk_region_zone_site, DROP COLUMN site_id;
      ALTER TABLE camera DROP CONSTRAINT fk_camera_gate_site, DROP CONSTRAINT ck_camera_purpose,
        DROP CONSTRAINT uq_camera_source_gate_site, DROP COLUMN gate_id, DROP COLUMN type;
      DROP TABLE gate;`);
  }
}
