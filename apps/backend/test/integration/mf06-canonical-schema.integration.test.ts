import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const canonical = createIsolatedTestDatabase({ canonical: true });
before(() => canonical.initialize());
after(() => canonical.dispose());

test('canonical request/job columns and foreign key bindings match their persisted contracts', async () => {
  const db = canonical.dataSource;
  for (const table of ['zone_entry_assessment_request', 'zone_entry_assessment_job']) {
    const metadata = db.entityMetadatas.find((entity) => entity.tableName === table);
    assert.ok(metadata);
    const actual = await db.query(
      `SELECT column_name,is_nullable FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=$1 ORDER BY column_name`,
      [table],
    );
    assert.deepEqual(
      actual,
      metadata.columns
        .map((column) => ({
          column_name: column.databaseName,
          is_nullable: column.isNullable ? 'YES' : 'NO',
        }))
        .sort((a, b) => a.column_name.localeCompare(b.column_name)),
    );
    const foreignKeys = await db.query(
      `SELECT target.relname AS target,
       ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n,i)
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.i)::text[] AS columns,
       ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n,i)
         JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.i)::text[] AS referenced
       FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid
       JOIN pg_namespace scope ON scope.oid=source.relnamespace
       JOIN pg_class target ON target.oid=c.confrelid
       WHERE scope.nspname=current_schema() AND source.relname=$1 AND c.contype='f'`,
      [table],
    );
    const expected = metadata.foreignKeys.map((key) => ({
      target: key.referencedEntityMetadata.tableName,
      columns: key.columnNames,
      referenced: key.referencedColumnNames,
    }));
    const sorted = (values: unknown[]) => values.map((value) => JSON.stringify(value)).sort();
    assert.deepEqual(sorted(foreignKeys), sorted(expected), table);
  }
});
