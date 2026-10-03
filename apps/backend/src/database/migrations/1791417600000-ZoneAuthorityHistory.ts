import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive authority storage only. Writers/cutover must establish coverage separately. */
export class ZoneAuthorityHistory1791417600000 implements MigrationInterface {
  name = 'ZoneAuthorityHistory1791417600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE zone ADD CONSTRAINT uq_zone_authority_id_site UNIQUE (id, site_id);
      ALTER TABLE worker_site_zone_assignment ADD COLUMN contractor_id uuid,
        ADD CONSTRAINT fk_assignment_contractor_anchor FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT;
      ALTER TABLE zone_access_grant ADD COLUMN contractor_id uuid,
        ADD CONSTRAINT fk_worker_grant_contractor_anchor FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT;

      CREATE TABLE contractor_zone_access_grant (
        id uuid CONSTRAINT pk_contractor_zone_grant_id PRIMARY KEY,
        site_id uuid NOT NULL CONSTRAINT fk_contractor_zone_grant_site REFERENCES site(id) ON DELETE RESTRICT,
        zone_id uuid NOT NULL,
        contractor_id uuid NOT NULL CONSTRAINT fk_contractor_zone_grant_contractor REFERENCES contractor(id) ON DELETE RESTRICT,
        effect varchar(8) NOT NULL,
        valid_from timestamptz NOT NULL,
        valid_until timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_contractor_zone_grant_zone_site FOREIGN KEY (zone_id, site_id) REFERENCES zone(id, site_id) ON DELETE RESTRICT,
        CONSTRAINT chk_contractor_zone_grant_effect CHECK (effect IN ('ALLOW','DENY')),
        CONSTRAINT chk_contractor_zone_grant_interval CHECK (
          isfinite(valid_from) AND (valid_until IS NULL OR (isfinite(valid_until) AND valid_until > valid_from))
          AND (revoked_at IS NULL OR isfinite(revoked_at)))
      );
      CREATE INDEX idx_contractor_zone_grant_lookup ON contractor_zone_access_grant(site_id,zone_id,contractor_id,valid_from);

      CREATE TABLE zone_authority_command (
        command_id uuid CONSTRAINT pk_zone_authority_command PRIMARY KEY,
        operation varchar(64) NOT NULL,
        actor_kind varchar(8) NOT NULL,
        actor_user_id uuid CONSTRAINT fk_authority_command_actor REFERENCES app_user(id) ON DELETE RESTRICT,
        service_subject varchar(64),
        recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
        request_hash char(64) NOT NULL,
        CONSTRAINT chk_authority_command_operation CHECK (char_length(operation) BETWEEN 1 AND 64 AND operation=btrim(operation)),
        CONSTRAINT chk_authority_command_actor CHECK (
          (actor_kind='USER' AND actor_user_id IS NOT NULL AND service_subject IS NULL) OR
          (actor_kind='SERVICE' AND actor_user_id IS NULL AND service_subject IS NOT NULL
            AND char_length(service_subject) BETWEEN 1 AND 64 AND service_subject=btrim(service_subject))),
        CONSTRAINT chk_authority_command_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_authority_command_time CHECK (isfinite(recorded_at))
      );

      CREATE TABLE zone_authority_fact_revision (
        id uuid CONSTRAINT pk_zone_authority_fact PRIMARY KEY,
        source_id uuid NOT NULL,
        command_id uuid NOT NULL CONSTRAINT fk_authority_fact_command REFERENCES zone_authority_command(command_id) ON DELETE RESTRICT,
        source_kind varchar(32) NOT NULL,
        revision bigint NOT NULL,
        site_id uuid CONSTRAINT fk_authority_fact_site REFERENCES site(id) ON DELETE RESTRICT,
        effective_from timestamptz NOT NULL,
        effective_to timestamptz,
        recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
        payload jsonb NOT NULL,
        CONSTRAINT uq_authority_fact_revision UNIQUE(source_kind,source_id,revision),
        CONSTRAINT chk_authority_fact_revision CHECK (revision > 0),
        CONSTRAINT chk_authority_fact_scope CHECK (
          (source_kind='CONTRACTOR_STATE' AND site_id IS NULL) OR
          (source_kind IN ('WORKER_MEMBERSHIP','PARTICIPATION','ASSIGNMENT','CONTRACTOR_ZONE_GRANT','WORKER_ZONE_GRANT','ZONE_POLICY') AND site_id IS NOT NULL)),
        CONSTRAINT chk_authority_fact_interval CHECK (
          isfinite(effective_from) AND isfinite(recorded_at)
          AND (effective_to IS NULL OR (isfinite(effective_to) AND effective_to > effective_from))),
        CONSTRAINT chk_authority_fact_payload CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text) <= 16384)
      );
      CREATE INDEX idx_authority_fact_scope_time ON zone_authority_fact_revision(site_id,source_kind,source_id,effective_from,recorded_at);
      CREATE INDEX idx_authority_fact_command ON zone_authority_fact_revision(command_id);

      CREATE TABLE zone_authority_history_epoch (
        site_id uuid CONSTRAINT pk_zone_authority_epoch PRIMARY KEY CONSTRAINT fk_authority_epoch_site REFERENCES site(id) ON DELETE RESTRICT,
        started_at timestamptz NOT NULL,
        readiness varchar(8) NOT NULL DEFAULT 'OFF',
        writer_manifest_hash char(64) NOT NULL,
        CONSTRAINT chk_authority_epoch_ready CHECK (readiness IN ('OFF','READY')),
        CONSTRAINT chk_authority_epoch_time CHECK (isfinite(started_at)),
        CONSTRAINT chk_authority_epoch_hash CHECK (writer_manifest_hash ~ '^[0-9a-f]{64}$')
      );

      CREATE FUNCTION reject_zone_authority_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE has_rows boolean;
      BEGIN
        IF TG_OP='TRUNCATE' THEN
          -- TRUNCATE already owns ACCESS EXCLUSIVE: no concurrent insert can
          -- appear between this check and an allowed empty-table cleanup.
          EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)', TG_TABLE_SCHEMA, TG_TABLE_NAME) INTO has_rows;
          IF NOT has_rows THEN RETURN NULL; END IF;
        END IF;
        RAISE EXCEPTION 'Zone authority audit is append-only' USING ERRCODE='23514';
      END $$;
      CREATE TRIGGER trg_authority_command_append_only BEFORE UPDATE OR DELETE ON zone_authority_command
        FOR EACH ROW EXECUTE FUNCTION reject_zone_authority_audit_mutation();
      CREATE TRIGGER trg_authority_command_no_truncate BEFORE TRUNCATE ON zone_authority_command
        FOR EACH STATEMENT EXECUTE FUNCTION reject_zone_authority_audit_mutation();
      CREATE TRIGGER trg_authority_fact_append_only BEFORE UPDATE OR DELETE ON zone_authority_fact_revision
        FOR EACH ROW EXECUTE FUNCTION reject_zone_authority_audit_mutation();
      CREATE TRIGGER trg_authority_fact_no_truncate BEFORE TRUNCATE ON zone_authority_fact_revision
        FOR EACH STATEMENT EXECUTE FUNCTION reject_zone_authority_audit_mutation();

      CREATE FUNCTION reject_zone_authority_anchor_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.contractor_id IS DISTINCT FROM OLD.contractor_id THEN
          RAISE EXCEPTION 'Contractor authority anchor is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_assignment_contractor_anchor BEFORE UPDATE ON worker_site_zone_assignment
        FOR EACH ROW EXECUTE FUNCTION reject_zone_authority_anchor_change();
      CREATE TRIGGER trg_worker_grant_contractor_anchor BEFORE UPDATE ON zone_access_grant
        FOR EACH ROW EXECUTE FUNCTION reject_zone_authority_anchor_change();
      CREATE TRIGGER trg_contractor_grant_contractor_anchor BEFORE UPDATE ON contractor_zone_access_grant
        FOR EACH ROW EXECUTE FUNCTION reject_zone_authority_anchor_change();
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Lock/check/drop in one statement: direct invocations cannot partially drop schema.
    // Existing NULL anchors do not carry newly acquired ownership and may be retained.
    await runner.query(`
      DO $$ BEGIN
        LOCK TABLE zone, worker_site_zone_assignment, zone_access_grant, contractor_zone_access_grant,
          zone_authority_command, zone_authority_fact_revision, zone_authority_history_epoch IN ACCESS EXCLUSIVE MODE;
        IF EXISTS(SELECT 1 FROM contractor_zone_access_grant)
          OR EXISTS(SELECT 1 FROM zone_authority_command)
          OR EXISTS(SELECT 1 FROM zone_authority_fact_revision)
          OR EXISTS(SELECT 1 FROM zone_authority_history_epoch)
          OR EXISTS(SELECT 1 FROM worker_site_zone_assignment WHERE contractor_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM zone_access_grant WHERE contractor_id IS NOT NULL) THEN
          RAISE EXCEPTION 'Refusing to revert populated Zone authority';
        END IF;
        DROP TRIGGER trg_assignment_contractor_anchor ON worker_site_zone_assignment;
        DROP TRIGGER trg_worker_grant_contractor_anchor ON zone_access_grant;
        DROP TABLE zone_authority_fact_revision, zone_authority_command, zone_authority_history_epoch, contractor_zone_access_grant;
        DROP FUNCTION reject_zone_authority_audit_mutation();
        DROP FUNCTION reject_zone_authority_anchor_change();
        ALTER TABLE worker_site_zone_assignment DROP COLUMN contractor_id;
        ALTER TABLE zone_access_grant DROP COLUMN contractor_id;
        ALTER TABLE zone DROP CONSTRAINT uq_zone_authority_id_site;
      END $$;
    `);
  }
}
