import assert from 'node:assert/strict';
import { test } from 'node:test';

// Dynamic lookup makes absent implementation a behavior RED, not an import error.
const path = '../src/camera-ppe-policy.js';
const api = await import(path).catch(() => ({}));
const parseCamera = api.parseCameraPpePolicy as (v: unknown) => unknown;
const parseRegion = api.parseRegionPpePolicy as (v: unknown) => unknown;
interface Result {
  scope: string;
  requiredPpe: string[];
  contributions: { requiredPpe: string[] }[];
}
const resolve = api.resolvePpePolicyAtLocation as (camera: unknown, regions: unknown) => Result;
const camera = { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] };
const vest = { mode: 'EXPLICIT', requiredPpe: ['SAFETY_VEST'] };
const inherit = { mode: 'INHERIT' };
const disabled = { mode: 'DISABLED', reason: 'Approved local exception' };

test('sparse explicit item arrays cannot create an undefined policy requirement', () => {
  for (const requiredPpe of [new Array(1), Object.assign(new Array(2), { 0: 'BOOTS' })]) {
    const invalid = { mode: 'EXPLICIT', requiredPpe };
    assert.equal(parseCamera(invalid), null);
    assert.equal(parseRegion(invalid), null);
    assert.throws(() => resolve(camera, [invalid]));
    assert.throws(() => resolve(invalid, []));
  }
});

test('camera default applies outside all polygons without inventing a Region', () => {
  assert.equal(typeof resolve, 'function');
  assert.deepEqual(resolve(camera, []), {
    scope: 'CAMERA',
    requiredPpe: ['HARD_HAT'],
    contributions: [
      { bindingIndex: null, mode: 'EXPLICIT', source: 'CAMERA_DEFAULT', requiredPpe: ['HARD_HAT'] },
    ],
  });
});

test('explicit polygon replaces default locally; overlapping inherit still contributes', () => {
  assert.deepEqual(resolve(camera, [vest]).requiredPpe, ['SAFETY_VEST']);
  const result = resolve(camera, [vest, inherit, disabled]);
  assert.equal(result.scope, 'REGIONS');
  assert.deepEqual(result.requiredPpe, ['HARD_HAT', 'SAFETY_VEST']);
  assert.deepEqual(result.contributions, [
    { bindingIndex: 0, mode: 'EXPLICIT', source: 'REGION', requiredPpe: ['SAFETY_VEST'] },
    { bindingIndex: 1, mode: 'INHERIT', source: 'CAMERA_DEFAULT', requiredPpe: ['HARD_HAT'] },
    { bindingIndex: 2, mode: 'DISABLED', source: 'REGION', requiredPpe: [] },
  ]);
});

test('disabled affects only its binding and never cancels another overlap', () => {
  assert.deepEqual(resolve(camera, [disabled]).requiredPpe, []);
  assert.deepEqual(resolve(camera, [disabled, disabled]).requiredPpe, []);
  assert.deepEqual(resolve(camera, [disabled, vest]).requiredPpe, ['SAFETY_VEST']);
  assert.deepEqual(resolve(camera, [disabled, inherit]).requiredPpe, ['HARD_HAT']);
  assert.deepEqual(resolve(disabled, [inherit, vest]).requiredPpe, ['SAFETY_VEST']);
  assert.deepEqual(resolve(disabled, []).requiredPpe, []);
});

test('parsers enforce explicit modes, supported unique items and deliberate disabling', () => {
  assert.deepEqual(parseRegion(inherit), inherit);
  assert.equal(parseCamera(inherit), null);
  assert.deepEqual(parseCamera({ mode: 'DISABLED', reason: '  maintenance  ' }), {
    mode: 'DISABLED',
    reason: 'maintenance',
  });
  assert.deepEqual(parseCamera({ mode: 'EXPLICIT', requiredPpe: ['SAFETY_VEST', 'BOOTS'] }), {
    mode: 'EXPLICIT',
    requiredPpe: ['BOOTS', 'SAFETY_VEST'],
  });
  for (const bad of [
    null,
    [],
    {},
    { mode: 'AUTO' },
    { ...inherit, requiredPpe: [] },
    { mode: 'EXPLICIT', requiredPpe: [] },
    { mode: 'EXPLICIT', requiredPpe: ['MASK'] },
    { mode: 'EXPLICIT', requiredPpe: ['BOOTS', 'BOOTS'] },
    { mode: 'EXPLICIT', requiredPpe: [null] },
    { ...camera, approved: true },
    { mode: 'DISABLED' },
    { ...disabled, reason: ' ' },
    { ...disabled, reason: 'bad\nreason' },
    { ...disabled, reason: 'x'.repeat(501) },
    { ...disabled, requiredPpe: [] },
    Object.assign(Object.create(camera), {}),
    { ...camera, [Symbol('hidden')]: true },
  ]) {
    assert.equal(parseCamera(bad), null);
    assert.equal(parseRegion(bad), null);
  }
});

test('resolver rejects invalid runtime input instead of silently weakening requirements', () => {
  for (const [parent, regions] of [
    [inherit, []],
    [camera, null],
    [camera, [null]],
    [camera, Array(65).fill(inherit)],
    [camera, new Array(1)],
    [camera, [{ mode: 'EXPLICIT', requiredPpe: [] }]],
  ])
    assert.throws(() => resolve(parent, regions));
  assert.equal(resolve(camera, Array(64).fill(inherit)).contributions.length, 64);
});

test('canonical union and per-binding copies preserve inputs and output independence', () => {
  const input = {
    mode: 'EXPLICIT',
    requiredPpe: ['SAFETY_VEST', 'GOGGLES', 'BOOTS', 'GLOVES', 'HARD_HAT'],
  };
  const before = structuredClone(input);
  const parsed = parseCamera(input) as typeof input;
  const result = resolve(input, [input, inherit]);
  assert.deepEqual(result.requiredPpe, ['BOOTS', 'GLOVES', 'GOGGLES', 'HARD_HAT', 'SAFETY_VEST']);
  parsed.requiredPpe.length = 0;
  result.contributions[0].requiredPpe.length = 0;
  assert.deepEqual(input, before);
  assert.equal(result.contributions[1].requiredPpe.length, 5);
  assert.equal(result.requiredPpe.length, 5);
});
