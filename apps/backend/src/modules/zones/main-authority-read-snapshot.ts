import type { DataSource, EntityManager } from 'typeorm';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../common/configuration/main-team-authority-sources.js';

/** Own the transaction so source writers drain before its first data snapshot. */
export async function readMainAuthoritySnapshot<T>(
  source: DataSource,
  operation: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const schema = source.driver.schema;
  if (typeof schema !== 'string' || !schema || schema.includes('\0'))
    throw new Error('Selected authority schema required');
  const quote = (identifier: string) => '"' + identifier.replaceAll('"', '""') + '"';
  return source.transaction('SERIALIZABLE', async (manager) => {
    await manager.query("SET LOCAL lock_timeout='1500ms'");
    await manager.query("SET LOCAL statement_timeout='5s'");
    // A SELECT, including catalog validation, before this lock would freeze an old snapshot.
    await manager.query(
      `LOCK TABLE ${MAIN_AUTHORITY_V2_SOURCES.map(([, table]) => `${quote(schema)}.${quote(table)}`).join(',')} IN SHARE MODE`,
    );
    await manager.query('SET TRANSACTION READ ONLY');
    await manager.query("SELECT set_config('search_path',quote_ident($1)||', pg_temp',true)", [
      schema,
    ]);
    const [selected] = await manager.query('SELECT current_schema()=$1::text AS valid', [schema]);
    if (selected?.valid !== true) throw new Error('Selected authority schema unavailable');
    return operation(manager);
  });
}
