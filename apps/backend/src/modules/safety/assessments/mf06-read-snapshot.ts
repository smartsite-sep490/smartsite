import type { DataSource, EntityManager } from 'typeorm';
import { missing } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';

/** Selected-schema snapshot shared by the two persisted MF06 read endpoints. */
export async function readMf06Snapshot<T>(
  db: DataSource,
  scope: string,
  relations: readonly string[],
  operation: (manager: EntityManager) => Promise<T>,
  unavailable: () => PublicHttpException,
): Promise<T> {
  const selectedSchema = db.driver.schema;
  if (typeof selectedSchema !== 'string' || !selectedSchema || selectedSchema.includes('\0'))
    throw unavailable();
  try {
    return await db.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await manager.query("SET LOCAL statement_timeout='5s'");
      const [namespace] = await manager.query(
        `SELECT current_schema() AS name,current_schema()=$1::text AND
          NOT EXISTS (SELECT 1 FROM unnest($2::text[]) AS names(name)
            WHERE to_regclass(format('%I.%I',$1::text,names.name)) IS NULL) AS ready`,
        [selectedSchema, relations],
      );
      if (namespace?.ready !== true || namespace.name !== selectedSchema) throw unavailable();
      // Qualified read locks retain the required relations until this transaction ends.
      const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
      await manager.query(
        `LOCK TABLE ${relations.map((name) => `${quote(selectedSchema)}.${quote(name)}`).join(',')} IN ACCESS SHARE MODE`,
      );
      // Without an explicit final pg_temp entry, PostgreSQL searches temporary
      // relations first, even when the path contains just the selected schema.
      await manager.query("SELECT set_config('search_path',quote_ident($1)||', pg_temp',true)", [
        selectedSchema,
      ]);
      const sites = await manager.query('SELECT id FROM site WHERE id=$1', [scope]);
      if (!sites[0]) return missing();
      return operation(manager);
    });
  } catch (error) {
    if (error instanceof PublicHttpException) throw error;
    throw unavailable();
  }
}
