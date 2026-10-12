import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ContractorTeams1791676800004 implements MigrationInterface {
  name = 'ContractorTeams1791676800004';
  async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE worker ADD CONSTRAINT uq_worker_id_site UNIQUE(id,site_id);
      CREATE TABLE contractor_team (
        id uuid CONSTRAINT pk_team_id PRIMARY KEY, site_id uuid NOT NULL CONSTRAINT fk_team_site REFERENCES site(id) ON DELETE RESTRICT,
        contractor_id uuid NOT NULL CONSTRAINT fk_team_contractor REFERENCES contractor(id) ON DELETE RESTRICT,
        name varchar(160) NOT NULL, normalized_name varchar(160) NOT NULL, description varchar(1000) NOT NULL DEFAULT '',
        is_active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
        created_by uuid NOT NULL CONSTRAINT fk_team_creator REFERENCES app_user(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_team_scope UNIQUE(id,site_id,contractor_id),
        CONSTRAINT ck_team_name CHECK(char_length(trim(name)) BETWEEN 1 AND 160), CONSTRAINT ck_team_version CHECK(version>0));
      CREATE UNIQUE INDEX uq_team_active_name ON contractor_team(site_id,contractor_id,normalized_name) WHERE is_active = true;
      CREATE TABLE contractor_team_membership (
        id uuid CONSTRAINT pk_team_membership_id PRIMARY KEY, site_id uuid NOT NULL, contractor_id uuid NOT NULL, team_id uuid NOT NULL, worker_id uuid NOT NULL,
        joined_at timestamptz NOT NULL, left_at timestamptz,
        assigned_by uuid NOT NULL CONSTRAINT fk_membership_assigner REFERENCES app_user(id) ON DELETE RESTRICT,
        reason varchar(1000) NOT NULL, ended_by uuid CONSTRAINT fk_membership_ender REFERENCES app_user(id) ON DELETE RESTRICT,
        end_reason varchar(1000),
        CONSTRAINT fk_membership_team_scope FOREIGN KEY(team_id,site_id,contractor_id) REFERENCES contractor_team(id,site_id,contractor_id) ON DELETE RESTRICT,
        CONSTRAINT fk_membership_worker_site FOREIGN KEY(worker_id,site_id) REFERENCES worker(id,site_id) ON DELETE RESTRICT,
        CONSTRAINT ck_team_membership_interval CHECK(left_at IS NULL OR left_at>=joined_at));
      CREATE UNIQUE INDEX uq_team_worker_active ON contractor_team_membership(site_id,worker_id) WHERE left_at IS NULL;
      CREATE INDEX idx_team_members ON contractor_team_membership(team_id,left_at);
      CREATE FUNCTION validate_team_membership_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.left_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM worker w JOIN contractor_team t ON t.id=NEW.team_id AND t.site_id=w.site_id AND t.contractor_id=w.contractor_id
          WHERE w.id=NEW.worker_id AND w.site_id=NEW.site_id AND w.contractor_id=NEW.contractor_id AND w.is_active AND t.is_active
        ) THEN RAISE EXCEPTION 'Invalid active team membership scope' USING ERRCODE='23514'; END IF;
        RETURN NEW; END $$;
      CREATE TRIGGER team_membership_scope BEFORE INSERT OR UPDATE ON contractor_team_membership FOR EACH ROW EXECUTE FUNCTION validate_team_membership_scope();
      ALTER TABLE shift_swap_request
        ADD COLUMN expected_team_id uuid CONSTRAINT fk_swap_team REFERENCES contractor_team(id) ON DELETE RESTRICT,
        ADD COLUMN expected_requester_membership_id uuid CONSTRAINT fk_swap_requester_membership REFERENCES contractor_team_membership(id) ON DELETE RESTRICT,
        ADD COLUMN expected_coworker_membership_id uuid CONSTRAINT fk_swap_coworker_membership REFERENCES contractor_team_membership(id) ON DELETE RESTRICT;
      UPDATE shift_swap_request SET status='CONFLICTED', review_reason='Team membership is required; submit a new swap request'
        WHERE status IN ('PENDING_COWORKER','PENDING_MANAGER','APPROVED');`);
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM contractor_team) THEN RAISE EXCEPTION 'Downgrade refused: team history must be preserved'; END IF; END $$;
      ALTER TABLE shift_swap_request DROP COLUMN expected_coworker_membership_id, DROP COLUMN expected_requester_membership_id, DROP COLUMN expected_team_id;
      DROP TABLE contractor_team_membership; DROP FUNCTION validate_team_membership_scope(); DROP TABLE contractor_team;
      ALTER TABLE worker DROP CONSTRAINT uq_worker_id_site;`);
  }
}
