import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthorizationHistoryCutover1793232000000 } from '../src/database/migrations/1793232000000-AuthorizationHistoryCutover.js';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';

test('authority cutover is registered exactly once after all predecessor timestamps', () => {
  const candidate = new AuthorizationHistoryCutover1793232000000();
  const registered = buildTypeOrmOptions({
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5433/smartsite_test',
    DATABASE_TIMEOUT_MS: 1000,
  }).migrations;
  assert(Array.isArray(registered));
  const names = registered.map((migration) =>
    typeof migration === 'function' ? migration.name : String(migration),
  );
  assert.equal(names.filter((name) => name === candidate.name).length, 1);
  assert.equal(candidate.name, 'AuthorizationHistoryCutover1793232000000');

  const candidateIndex = names.indexOf(candidate.name);
  assert(candidateIndex > 0);
  assert.equal(registered[candidateIndex], AuthorizationHistoryCutover1793232000000);

  const predecessors = names.slice(0, candidateIndex);
  for (const requiredPredecessor of [
    'Mf06MainAuthorityJournal1791590400002',
    'Mf06TeamAuthorityHistory1792281600000',
    'ZoneEntryPhysicalStorage1792454400000',
    'ExpandedPpeNotificationKinds1793145600000',
  ]) {
    assert(
      predecessors.includes(requiredPredecessor),
      `Expected ${requiredPredecessor} to be registered before ${candidate.name}`,
    );
  }

  const candidateTimestamp = Number(candidate.name.slice(-13));
  assert(candidateTimestamp > Math.max(...predecessors.map((name) => Number(name.slice(-13)))));

  for (const successor of names.slice(candidateIndex + 1)) {
    assert(Number(successor.slice(-13)) > candidateTimestamp);
  }
});
