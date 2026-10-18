import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';
import { reviewedReleaseMigrationNames } from './support/reviewed-release-graph.js';

const registered = buildTypeOrmOptions({
  DATABASE_URL: 'postgresql://unit:unit@localhost/unit',
}).migrations;
assert(Array.isArray(registered));
const qrName = 'WorkerQrShortCodes1792454400000';
const mainDocumentNames = [
  'WorkerDocuments1792540800000',
  'WorkerDocumentIdentityChecks1792627200000',
  'WorkerDocumentSubmittedExpiry1792713600000',
  'WorkerHealthIssueDate1792800000000',
];
const root61 = registered.filter(
  (migration) =>
    typeof migration !== 'function' ||
    (migration.name !== qrName && !mainDocumentNames.includes(migration.name)),
);
class WorkerQrShortCodes1792454400000 {}

test('the current release preserves the reviewed Root61 and exact Main additions', () => {
  const names = reviewedReleaseMigrationNames(registered);
  assert.equal(names.length, registered.length);
  assert.equal(reviewedReleaseMigrationNames(root61).length, 61);
});

test('the reviewed Main document extension qualifies as exactly 66 ordered registrations', () => {
  const additions = registered.filter(
    (migration) => typeof migration === 'function' && mainDocumentNames.includes(migration.name),
  );
  assert.equal(additions.length, 4);
  assert.equal(
    reviewedReleaseMigrationNames([...root61, WorkerQrShortCodes1792454400000, ...additions])
      .length,
    66,
  );
  assert.throws(() => reviewedReleaseMigrationNames([...root61, ...additions]));
  assert.throws(() =>
    reviewedReleaseMigrationNames([
      ...root61,
      WorkerQrShortCodes1792454400000,
      ...additions.slice(1),
    ]),
  );
});

test('the reviewed Main QR extension qualifies as exactly 62 registrations', () => {
  assert.equal(
    reviewedReleaseMigrationNames([...root61, WorkerQrShortCodes1792454400000]).length,
    62,
  );
});

test('initialized migration instances preserve the same reviewed graph qualification', () => {
  const instances = root61.map((migration) => {
    assert.equal(typeof migration, 'function');
    return { name: (migration as { name: string }).name };
  });
  assert.equal(reviewedReleaseMigrationNames(instances).length, 61);
});

test('unreviewed replacements, additions, omissions, duplicates and reordering are rejected', () => {
  class UnreviewedMigration1799999999999 {}
  const swapped = [...root61];
  [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
  for (const invalid of [
    [...root61.slice(0, -1), UnreviewedMigration1799999999999],
    [...root61, UnreviewedMigration1799999999999],
    root61.slice(1),
    [...root61.slice(0, -1), root61[0]],
    swapped,
    [WorkerQrShortCodes1792454400000, ...root61],
  ]) {
    assert.throws(() => reviewedReleaseMigrationNames(invalid));
  }
});

test('glob paths, malformed registrations and non-array inputs fail closed', () => {
  for (const invalid of [undefined, '*.js', [...root61.slice(1), '*.js'], [null], [{}]]) {
    assert.throws(() => reviewedReleaseMigrationNames(invalid));
  }
});
