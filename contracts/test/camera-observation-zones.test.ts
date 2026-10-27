import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as contracts from '../src/index.js';

const site = '11111111-1111-4111-8111-111111111111';
const camera = '22222222-2222-4222-8222-222222222222';
const zone = '33333333-3333-4333-8333-333333333333';
const value = () => ({
  siteId: site,
  cameraId: camera,
  configurationVersion: 3,
  items: [{ id: zone, code: 'GATE', name: 'Cổng chính' }],
  total: 1,
  unresolvedRegionCount: 0,
});
function parse(input: unknown) {
  const parser = (contracts as unknown as Record<string, unknown>).parseCameraObservationZones;
  assert.equal(typeof parser, 'function');
  return (parser as (v: unknown) => unknown)(input);
}
describe('camera observation Zone metadata contract', () => {
  it('preserves scoped names and current revision without media fields', () => {
    assert.deepEqual(parse(value()), value());
  });
  it('accepts true empty and explicitly unresolved Region context separately', () => {
    assert.deepEqual(parse({ ...value(), items: [], total: 0 }), {
      ...value(),
      items: [],
      total: 0,
    });
    const unresolved = { ...value(), items: [], total: 0, unresolvedRegionCount: 2 };
    assert.deepEqual(parse(unresolved), unresolved);
  });
  it('allows a bounded partial page and empty final offset', () => {
    assert.deepEqual(parse({ ...value(), total: 64 }), { ...value(), total: 64 });
    assert.deepEqual(parse({ ...value(), total: 1, items: [] }), {
      ...value(),
      total: 1,
      items: [],
    });
  });
  for (const extra of [{ polygon: [] }, { sourceUrl: 'private' }, { workers: [] }]) {
    it(`rejects unexpected transport property ${Object.keys(extra)[0]}`, () => {
      assert.throws(() => parse({ ...value(), ...extra }));
    });
  }
  it('rejects malformed scope, revisions and counts', () => {
    for (const bad of [
      { siteId: 'not-uuid' },
      { cameraId: null },
      { configurationVersion: 0 },
      { configurationVersion: Number.MAX_SAFE_INTEGER + 1 },
      { total: -1 },
      { total: 65 },
      { total: 0 },
      { unresolvedRegionCount: 65 },
      { total: 64, unresolvedRegionCount: 1 },
    ])
      assert.throws(() => parse({ ...value(), ...bad }));
  });
  it('rejects duplicate IDs, secret-bearing and malformed Zone metadata', () => {
    for (const items of [
      [value().items[0], value().items[0]],
      [{ id: 'bad', code: 'x', name: 'x' }],
      [{ id: zone, code: '', name: 'x' }],
      [{ id: zone, code: 'x', name: '\u0000' }],
      [{ ...value().items[0], siteId: site }],
      [{ id: zone, code: 'x', name: 'x'.repeat(256) }],
    ])
      assert.throws(() => parse({ ...value(), items, total: 2 }));
  });
});
