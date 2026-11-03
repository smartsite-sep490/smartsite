import type { QueryRunner } from 'typeorm';

/** Lock permanent, explicitly scoped sources before checking or retiring their data. */
export async function lockCleanupTables(runner: QueryRunner, names: readonly string[]) {
  if (!runner.isTransactionActive) throw new Error('ERD cleanup requires a transaction');
  const schema = runner.connection.driver.schema ?? 'public';
  if (
    !schema ||
    schema.startsWith('pg_') ||
    schema === 'information_schema' ||
    schema.includes('\0')
  )
    throw new Error('ERD cleanup requires an application schema');
  const quote = (name: string) => runner.connection.driver.escape(name);
  const table = (name: string) => `${quote(schema)}.${quote(name)}`;
  const sources = (await runner.query(
    `SELECT c.relname FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND c.relkind='r' AND c.relpersistence='p'`,
    [schema, names],
  )) as { relname: string }[];
  if (sources.length !== names.length) throw new Error('ERD cleanup prerequisites are missing');
  await runner.query(
    `LOCK TABLE ${[...names].sort().map(table).join(',')} IN ACCESS EXCLUSIVE MODE`,
  );
  return table;
}
