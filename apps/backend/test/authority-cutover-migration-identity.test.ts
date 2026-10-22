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
  assert.equal(names.at(-1), candidate.name);
  assert.equal(candidate.name, 'AuthorizationHistoryCutover1793232000000');
  assert(
    Number(candidate.name.slice(-13)) >
      Math.max(
        ...names.filter((name) => name !== candidate.name).map((name) => Number(name.slice(-13))),
      ),
  );
});
