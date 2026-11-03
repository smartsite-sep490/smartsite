import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAIN_AUTHORITY_SOURCES } from '../src/common/configuration/main-authority-sources.js';

const v1 = MAIN_AUTHORITY_SOURCES;
const current = [
  ...v1.map(
    ([kind, table, fields]) =>
      [kind, table, kind === 'ASSIGNMENT' ? [...fields, 'zone_ids'] : fields] as const,
  ),
  ['TEAM', 'contractor_team', ['id', 'site_id']] as const,
];
const documents = (registry: typeof current | typeof v1) =>
  registry.map(([sourceKind, tableName, fields]) => ({
    sourceKind,
    tableName,
    fields: [...fields],
    rows: [],
  }));

async function profile() {
  const file = '../src/modules/zones/main-authority-baseline-profile.js';
  const module = (await import(file).catch((error: { code?: string }) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  })) as {
    baselineSourceProfile?: (
      sources: unknown,
      installed: readonly (readonly [string, string, readonly string[]])[],
    ) => 'V1' | 'CURRENT' | null;
  };
  assert.equal(
    typeof module.baselineSourceProfile,
    'function',
    'Stored baseline needs an explicit frozen source profile',
  );
  return module.baselineSourceProfile!;
}

test('frozen V1 masks remain V1 under an explicitly installed later registry', async () => {
  assert.equal((await profile())(documents(v1), current), 'V1');
});
test('only the exact current source masks select the current archive version', async () => {
  assert.equal((await profile())(documents(current), current), 'CURRENT');
});
test('missing, duplicate, mixed and unknown masks do not select a protocol', async () => {
  const read = await profile();
  for (const value of [
    null,
    {},
    [],
    documents(v1).slice(1),
    [...documents(v1), documents(v1)[0]],
    [...documents(v1).slice(1), documents(current).at(-1)],
  ])
    assert.equal(read(value, current), null);
});
test('field order, field membership and table binding stay protocol-scoped', async () => {
  const read = await profile();
  const changed: { sourceKind: string; tableName: string; fields: string[]; rows: unknown[] }[] =
    documents(v1);
  changed[0] = { ...changed[0]!, fields: [...changed[0]!.fields, 'extra'] };
  assert.equal(read(changed, current), null);
  changed[0] = { ...documents(v1)[0]!, tableName: 'other_site' };
  assert.equal(read(changed, current), null);
  changed[0] = { ...documents(v1)[0]!, fields: [...documents(v1)[0]!.fields].reverse() };
  assert.equal(read(changed, current), null);
});
test('source ordering is immaterial but source identity must not be duplicated', async () => {
  assert.equal((await profile())(documents(v1).reverse(), current), 'V1');
});
