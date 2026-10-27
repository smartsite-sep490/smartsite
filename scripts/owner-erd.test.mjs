import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root =
  process.env.SMARTSITE_TEST_SOURCE_REPO ?? fileURLToPath(new URL('..', import.meta.url));
const database = resolve(root, 'docs/database');

test('integration preserves the reviewed owner ERD, independent of checkout line endings', () => {
  const erd = readFileSync(resolve(database, 'ERD-Logical.dbml'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(
    createHash('sha256').update(erd).digest('hex'),
    '4ccc85f7eb348492eaa8b5d402d03e83ad109c4b8f55929fb0e269f66eeb125f',
    'Owner ERD changed: review the design explicitly; do not replace it with an observed schema',
  );
});

test('integration retains the baseline context and portable database handoff', () => {
  for (const name of [
    'README.md',
    'schema-extensions.md',
    'tuan-backend-coordination-20261016.md',
    'tuan-db-erd-handoff.md',
    'tuan-db-erd-mapping.csv',
  ]) {
    assert.ok(statSync(resolve(database, name)).isFile(), `Missing database handoff file: ${name}`);
  }
});

test('database handoff links resolve inside the source package', () => {
  const path = resolve(database, 'tuan-db-erd-handoff.md');
  const links = [...readFileSync(path, 'utf8').matchAll(/\]\(([^)]+)\)/g)];
  assert.ok(links.length > 0, 'Handoff must link to its source references');
  for (const [, target] of links) {
    assert.ok(statSync(resolve(dirname(path), target)).isFile(), `Missing handoff link: ${target}`);
  }
});
