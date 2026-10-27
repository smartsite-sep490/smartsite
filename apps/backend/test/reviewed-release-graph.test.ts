import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';
import { reviewedReleaseMigrationNames } from './support/reviewed-release-graph.js';

test('independent reviewed registry accepts current release and rejects unknown, missing or duplicate entries', () => {
  const registered = buildTypeOrmOptions({
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5433/smartsite_test',
  }).migrations;
  assert(Array.isArray(registered));
  const names = reviewedReleaseMigrationNames(registered);
  assert.equal(names.length, 81);
  for (const count of [61, 62, 66, 72, 73, 74, 75, 76, 77, 78, 79, 80])
    assert.equal(reviewedReleaseMigrationNames(registered.slice(0, count)).length, count);
  assert.equal(names.at(-1), 'ObservationFrameParts1794009600000');
  assert.deepEqual(reviewedReleaseMigrationNames(names.map((name) => ({ name }))), names);
  const reordered = [...registered];
  [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
  for (const invalid of [
    undefined,
    '*.js',
    [null],
    [{}],
    [...registered.slice(1), '*.js'],
    reordered,
    registered.filter((_, index) => index !== 61),
    registered.filter((_, index) => index !== 63),
    registered.filter((_, index) => index !== 73),
    registered.filter((_, index) => index !== 76),
    registered.filter((_, index) => index !== 77),
    registered.filter((_, index) => index !== 79),
    [...registered.slice(0, 61), registered.at(-1)],
  ])
    assert.throws(() => reviewedReleaseMigrationNames(invalid));
  assert.throws(() =>
    reviewedReleaseMigrationNames([...registered, class UnreviewedMigration1799999999999 {}]),
  );
  assert.throws(() => reviewedReleaseMigrationNames(registered.filter((_, index) => index !== 70)));
  assert.throws(() => reviewedReleaseMigrationNames([...registered, registered[0]]));
});
