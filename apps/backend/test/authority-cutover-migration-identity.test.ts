import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthorizationHistoryCutover1793232000000 } from '../src/database/migrations/1793232000000-AuthorizationHistoryCutover.js';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';

test('unregistered authority cutover candidate follows all registered migration timestamps', () => {
  const candidate = new AuthorizationHistoryCutover1793232000000();
  const registered = buildTypeOrmOptions({
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5433/smartsite_test',
    DATABASE_TIMEOUT_MS: 1000,
  }).migrations;
  assert(Array.isArray(registered));
  const names = registered.map((migration) =>
    typeof migration === 'function' ? migration.name : String(migration),
  );
  assert(!names.includes(candidate.name));
  assert.equal(candidate.name, 'AuthorizationHistoryCutover1793232000000');
  assert(
    Number(candidate.name.slice(-13)) > Math.max(...names.map((name) => Number(name.slice(-13)))),
  );
});
