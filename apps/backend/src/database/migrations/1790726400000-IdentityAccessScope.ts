import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IdentityAccessScope1790726400000 implements MigrationInterface {
  name = 'IdentityAccessScope1790726400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // An MF07-only database may already contain the older site-owned Contractor table.
    // Convert its data to the shared Contractor + Site participation model in this migration.
    const contractorExists = await queryRunner.hasTable('contractor');
    const legacySiteScoped = contractorExists && await queryRunner.hasColumn('contractor', 'site_id');
    if (contractorExists && !legacySiteScoped)
      throw new Error('Contractor table exists without a recorded IdentityAccessScope migration');
    const workerHasContractor = await queryRunner.hasColumn('worker', 'contractor_id');
    await queryRunner.query(`
      ${contractorExists ? '' : `CREATE TABLE contractor (
        id UUID NOT NULL,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_contractor_id PRIMARY KEY (id),
        CONSTRAINT uq_contractor_code UNIQUE (code)
      );`}
      CREATE TABLE contractor_site_participation (
        id UUID NOT NULL,
        contractor_id UUID NOT NULL,
        site_id UUID NOT NULL,
        valid_from TIMESTAMPTZ NOT NULL,
        valid_until TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_contractor_site_participation_id PRIMARY KEY (id),
        CONSTRAINT fk_contractor_site_participation_contractor FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT,
        CONSTRAINT fk_contractor_site_participation_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT chk_contractor_site_participation_interval CHECK (valid_until IS NULL OR valid_until > valid_from)
      );
      CREATE INDEX idx_contractor_site_participation_lookup ON contractor_site_participation (contractor_id, site_id, valid_from);
      CREATE TABLE contractor_representative_grant (
        id UUID NOT NULL,
        user_id UUID NOT NULL,
        contractor_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_contractor_representative_grant_id PRIMARY KEY (id),
        CONSTRAINT fk_contractor_representative_grant_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
        CONSTRAINT fk_contractor_representative_grant_contractor FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT,
        CONSTRAINT uq_contractor_representative_grant UNIQUE (user_id, contractor_id)
      );
      CREATE INDEX idx_contractor_representative_grant_user ON contractor_representative_grant (user_id);
      ${workerHasContractor ? '' : `ALTER TABLE worker ADD COLUMN contractor_id UUID;
      ALTER TABLE worker ADD CONSTRAINT fk_worker_contractor FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT;
      CREATE INDEX idx_worker_contractor ON worker (contractor_id) WHERE contractor_id IS NOT NULL;`}
      CREATE TABLE worker_site_zone_assignment (
        id UUID NOT NULL,
        worker_id UUID NOT NULL,
        site_id UUID NOT NULL,
        zone_ids UUID[] NOT NULL,
        status VARCHAR(32) NOT NULL,
        valid_from TIMESTAMPTZ NOT NULL,
        valid_until TIMESTAMPTZ,
        requested_by_user_id UUID NOT NULL,
        safety_reviewed_by_user_id UUID,
        site_manager_decided_by_user_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_worker_site_zone_assignment_id PRIMARY KEY (id),
        CONSTRAINT fk_worker_site_zone_assignment_worker FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_worker_site_zone_assignment_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_worker_site_zone_assignment_requester FOREIGN KEY (requested_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_worker_site_zone_assignment_safety_reviewer FOREIGN KEY (safety_reviewed_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_worker_site_zone_assignment_site_manager FOREIGN KEY (site_manager_decided_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_worker_site_zone_assignment_status CHECK (status IN ('PENDING', 'SAFETY_REVIEWED', 'APPROVED', 'REJECTED', 'CANCELLED')),
        CONSTRAINT chk_worker_site_zone_assignment_interval CHECK (valid_until IS NULL OR valid_until > valid_from),
        CONSTRAINT chk_worker_site_zone_assignment_zone_ids CHECK (cardinality(zone_ids) > 0)
      );
      CREATE INDEX idx_worker_site_zone_assignment_gate_lookup
        ON worker_site_zone_assignment (worker_id, site_id, status, valid_from);
    `);
    if (legacySiteScoped) {
      await queryRunner.query(`
        INSERT INTO contractor_site_participation
          (id, contractor_id, site_id, valid_from, valid_until, is_active, created_at)
        SELECT gen_random_uuid(), id, site_id, created_at, NULL, is_active, created_at
        FROM contractor
      `);
      await queryRunner.query(`
        INSERT INTO contractor_representative_grant (id, user_id, contractor_id, created_at)
        SELECT gen_random_uuid(), user_id, contractor_id, MIN(created_at)
        FROM contractor_representative_assignment
        GROUP BY user_id, contractor_id
      `);
      await queryRunner.query('DROP INDEX idx_contractor_site_active');
      await queryRunner.query('DROP INDEX idx_worker_contractor');
      await queryRunner.query('CREATE INDEX idx_worker_contractor ON worker (contractor_id) WHERE contractor_id IS NOT NULL');
      await queryRunner.query('ALTER TABLE contractor DROP CONSTRAINT uq_contractor_site_code');
      await queryRunner.query('ALTER TABLE contractor DROP COLUMN site_id');
      await queryRunner.query('ALTER TABLE contractor ADD CONSTRAINT uq_contractor_code UNIQUE (code)');
      await queryRunner.query('ALTER TABLE contractor_representative_assignment DROP CONSTRAINT uq_contractor_representative_assignment');
      await queryRunner.query('ALTER TABLE contractor_representative_assignment ADD CONSTRAINT uq_contractor_representative_assignment UNIQUE (site_id, contractor_id, user_id)');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const mf07WasAlreadyApplied = await queryRunner.query(
      "SELECT 1 FROM migrations WHERE name = 'Mf07WorkforceAccessScope1790812800000' LIMIT 1",
    ) as unknown[];
    if (mf07WasAlreadyApplied.length > 0)
      throw new Error('Cannot revert IdentityAccessScope while an MF07 Contractor migration still owns data');
    await queryRunner.query('DROP TABLE worker_site_zone_assignment');
    await queryRunner.query('DROP INDEX idx_worker_contractor');
    await queryRunner.query('ALTER TABLE worker DROP CONSTRAINT fk_worker_contractor');
    await queryRunner.query('ALTER TABLE worker DROP COLUMN contractor_id');
    await queryRunner.query('DROP TABLE contractor_representative_grant');
    await queryRunner.query('DROP TABLE contractor_site_participation');
    await queryRunner.query('DROP TABLE contractor');
  }
}
