import type { DataSource } from 'typeorm';

/** Projection columns for current ORM readers in an explicitly historical profile.
 * These suites test older upgrades with retained evidence and stop before GateRegistry.
 * The complete Gate constraints are exercised separately on a clean current schema.
 */
export async function installGateSchemaForHistoricalFixture(source: DataSource) {
  await source.transaction(async (manager) => {
    const [row] = await manager.query("SELECT to_regclass('gate') AS name");
    if (row.name) return;
    await manager.query(
      'ALTER TABLE camera ADD COLUMN type varchar(4) NOT NULL, ADD COLUMN gate_id uuid',
    );
    await manager.query('ALTER TABLE camera_observation_region ADD COLUMN site_id uuid NOT NULL');
  });
}
