import type { DataSource } from 'typeorm';

/** Projection columns for current ORM readers in an explicitly historical profile.
 * These suites test older upgrades with retained evidence and stop before GateRegistry.
 * Account email columns likewise let current account readers run without installing
 * unrelated outbox workflows or changing the historical migration boundary.
 * Complete Gate/email constraints are exercised on the clean current schema.
 */
export async function installGateSchemaForHistoricalFixture(source: DataSource) {
  await source.transaction(async (manager) => {
    await manager.query(
      'ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email varchar(254), ADD COLUMN IF NOT EXISTS email_verified_at timestamptz',
    );
    const [row] = await manager.query("SELECT to_regclass('gate') AS name");
    if (row.name) return;
    await manager.query(
      'ALTER TABLE camera ADD COLUMN type varchar(4) NOT NULL, ADD COLUMN gate_id uuid',
    );
    await manager.query('ALTER TABLE camera_observation_region ADD COLUMN site_id uuid NOT NULL');
  });
}

/** Remove fixture-only account columns before applying the actual email migration. */
export async function removeAccountEmailProjectionForHistoricalFixture(source: DataSource) {
  await source.query('ALTER TABLE app_user DROP COLUMN email_verified_at, DROP COLUMN email');
}
