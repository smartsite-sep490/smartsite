import { createHash } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';

export const SOFTWARE_ROW_HASH_FORMAT = 'POSTGRES_JSONB_TEXT_UTC_SHA256_V1' as const;

export interface SoftwareSchemaFingerprint {
  schema: string;
  rowHashFormat: typeof SOFTWARE_ROW_HASH_FORMAT;
  tables: readonly { name: string; rows: number; sha256: string }[];
}

export interface SoftwareSchemaSnapshot extends SoftwareSchemaFingerprint {
  snapshotId: string;
}

function assertSoftwareTarget(db: DataSource, schema: string) {
  const invalid = () => new Error('Explicit dedicated software schema target required');
  if (
    !db.isInitialized ||
    db.options.type !== 'postgres' ||
    !/^isolated_test_[a-f0-9]{32}$/.test(schema) ||
    db.options.schema !== schema ||
    db.options.synchronize !== false ||
    db.options.migrationsRun !== false ||
    typeof db.options.url !== 'string'
  )
    throw invalid();
  try {
    const url = new URL(db.options.url);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '5433' ||
      decodeURIComponent(url.username) !== 'smartsite_test' ||
      url.pathname !== '/smartsite_test' ||
      !url.password ||
      url.search ||
      url.hash
    )
      throw invalid();
  } catch {
    throw invalid();
  }
}

async function inventoryNames(runner: QueryRunner, schema: string): Promise<{ name: string }[]> {
  if ((await runner.query('SELECT current_schema() AS schema'))[0].schema !== schema)
    throw new Error('Explicit dedicated software schema target required');
  await runner.query("SET LOCAL TIME ZONE 'UTC'");
  const names: { name: string }[] = await runner.query(
    'SELECT tablename AS name FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',
    [schema],
  );
  if (
    !names.length ||
    names.length > 150 ||
    names.some(({ name }) => !/^[a-z_][a-z0-9_]*$/.test(name))
  )
    throw new Error('Software schema table inventory unavailable');
  return names;
}

async function fingerprintTables(runner: QueryRunner, schema: string, names: { name: string }[]) {
  const tables: { name: string; rows: number; sha256: string }[] = [];
  let totalRows = 0,
    totalBytes = 0;
  for (const { name } of names) {
    const rows: { value: string }[] = await runner.query(
      `SELECT to_jsonb(t)::text AS value FROM "${schema}"."${name}" t ORDER BY to_jsonb(t)::text LIMIT 10001`,
    );
    totalRows += rows.length;
    totalBytes += rows.reduce((sum, row) => sum + Buffer.byteLength(row.value), 0);
    if (totalRows > 10000 || totalBytes > 16 * 1024 * 1024)
      throw new Error('Software snapshot resource limit exceeded');
    tables.push({
      name,
      rows: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    });
  }
  return tables;
}

/** Readonly point-in-time rows for a retained-schema drift check, not writer quiescence or ownership proof. */
export async function readSoftwareSchemaFingerprint(
  db: DataSource,
  schema: string,
): Promise<SoftwareSchemaFingerprint> {
  assertSoftwareTarget(db, schema);
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction('REPEATABLE READ');
    await runner.query('SET TRANSACTION READ ONLY');
    await runner.query('SET LOCAL statement_timeout=5000');
    const names = await inventoryNames(runner, schema),
      tables = await fingerprintTables(runner, schema, names);
    return { schema, rowHashFormat: SOFTWARE_ROW_HASH_FORMAT, tables };
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
  }
}

/**
 * Local software maintenance only. The caller must independently establish exact
 * receipt/PID ownership and bound every callback operation, then retain a durable
 * backup before requesting shutdown. A name prefix is not ownership proof.
 *
 * SHARE locks stop ordinary writes only to this schema's existing tables. They do
 * not freeze files, sequence allocation, other namespaces or privileged DDL. No
 * HTTP handler/startup path imports this function. No migration or AI is executed.
 */
export async function withSoftwareSchemaFreeze<T>(
  db: DataSource,
  schema: string,
  callback: (snapshot: SoftwareSchemaSnapshot) => Promise<T>,
): Promise<T> {
  assertSoftwareTarget(db, schema);
  if (typeof callback !== 'function')
    throw new Error('Explicit dedicated software schema target required');
  const quote = (name: string) => `"${name}"`;
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction('READ COMMITTED');
    await runner.query('SET LOCAL lock_timeout=1000');
    await runner.query('SET LOCAL statement_timeout=5000');
    const names = await inventoryNames(runner, schema);
    await runner.query(
      `LOCK TABLE ${names.map(({ name }) => `${quote(schema)}.${quote(name)}`).join(',')} IN SHARE MODE`,
    );
    // READ COMMITTED takes a fresh row snapshot after waiting for preceding writers.
    // The locks now hold those rows stable while inventory and pg_dump run.
    const [{ snapshot_id: snapshotId }] = await runner.query(
      'SELECT pg_export_snapshot() AS snapshot_id',
    );
    const tables = await fingerprintTables(runner, schema, names);
    return await callback({ schema, snapshotId, tables, rowHashFormat: SOFTWARE_ROW_HASH_FORMAT });
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
  }
}
