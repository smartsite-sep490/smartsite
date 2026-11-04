import type { DataSource, EntityManager } from 'typeorm';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../common/configuration/main-team-authority-sources.js';

export class MainAuthoritySnapshotUnavailable extends Error {}

export const MAIN_AUTHORITY_SNAPSHOT_TABLES = [
  ...MAIN_AUTHORITY_V2_SOURCES.map(([, table]) => table),
  'authorization_history_epoch',
  'authorization_history_control',
] as const;

/** Own the transaction so source writers drain before its first data snapshot. */
export async function readMainAuthoritySnapshot<T>(
  source: DataSource,
  operation: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return withMainAuthoritySnapshot(source, operation, true);
}

/** Fence before the first snapshot while retaining writes for assessment finalization. */
export async function finalizeMainAuthoritySnapshot<T>(
  source: DataSource,
  operation: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return withMainAuthoritySnapshot(source, operation, false);
}

async function withMainAuthoritySnapshot<T>(
  source: DataSource,
  operation: (manager: EntityManager) => Promise<T>,
  readOnly: boolean,
): Promise<T> {
  const schema = source.driver.schema;
  if (
    typeof schema !== 'string' ||
    !schema ||
    schema.includes('\0') ||
    schema.startsWith('pg_') ||
    schema === 'information_schema'
  )
    throw new MainAuthoritySnapshotUnavailable('Selected authority schema required');
  const quote = (identifier: string) => '"' + identifier.replaceAll('"', '""') + '"';
  return source.transaction('SERIALIZABLE', async (manager) => {
    await manager.query("SET LOCAL lock_timeout='1500ms'");
    await manager.query("SET LOCAL statement_timeout='5s'");
    // A SELECT, including catalog validation, before this lock would freeze an old snapshot.
    await manager.query(
      `LOCK TABLE ${MAIN_AUTHORITY_SNAPSHOT_TABLES.map((table) => `${quote(schema)}.${quote(table)}`).join(',')} IN SHARE MODE`,
    );
    await manager.query(readOnly ? 'SET TRANSACTION READ ONLY' : 'SET TRANSACTION READ WRITE');
    // Frozen capture profiles use the schema-only path; reject pooled temp namespaces
    // instead of changing that profile or allowing implicit temporary-table shadowing.
    const [temporary] = await manager.query('SELECT pg_catalog.pg_my_temp_schema()<>0 AS present');
    if (temporary?.present !== false)
      throw new MainAuthoritySnapshotUnavailable('Temporary authority namespace unavailable');
    await manager.query("SELECT set_config('search_path',quote_ident($1),true)", [schema]);
    const [selected] = await manager.query('SELECT current_schema()=$1::text AS valid', [schema]);
    if (selected?.valid !== true)
      throw new MainAuthoritySnapshotUnavailable('Selected authority schema unavailable');
    return operation(manager);
  });
}
