import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPrivateEvidenceConfig } from './evidence-compose-validation.mjs';

const root = '/synthetic-private-evidence';
function config(bind = { create_host_path: false }) {
  return {
    services: {
      backend: {
        volumes: [
          {
            type: 'bind',
            source: root,
            target: '/var/lib/smartsite/evidence',
            read_only: true,
            bind,
          },
        ],
        environment: { EVIDENCE_LOCAL_ROOT: '/var/lib/smartsite/evidence' },
      },
      web: {},
    },
  };
}

test('explicit false is accepted in the normalized Compose model', () => {
  assertPrivateEvidenceConfig(config(), root);
});

test('older compose-go JSON omits a false create_host_path boolean', () => {
  assertPrivateEvidenceConfig(config({}), root, { falseIsOmitted: true });
});

test('omitted value is rejected unless a creation-enabled control proved false omission', () => {
  assert.throws(() => assertPrivateEvidenceConfig(config({}), root));
});

for (const value of [true, 'false', null, 0]) {
  test(`host creation value ${JSON.stringify(value)} is rejected`, () => {
    assert.throws(() => assertPrivateEvidenceConfig(config({ create_host_path: value }), root));
  });
}

for (const [name, mutate] of [
  [
    'writable evidence',
    (value) => {
      value.services.backend.volumes[0].read_only = false;
    },
  ],
  [
    'wrong host root',
    (value) => {
      value.services.backend.volumes[0].source = '/other';
    },
  ],
  [
    'non-bind mount',
    (value) => {
      value.services.backend.volumes[0].type = 'volume';
    },
  ],
  [
    'missing bind options',
    (value) => {
      delete value.services.backend.volumes[0].bind;
    },
  ],
  [
    'reader path mismatch',
    (value) => {
      value.services.backend.environment.EVIDENCE_LOCAL_ROOT = '/other';
    },
  ],
  [
    'Web evidence mount',
    (value) => {
      value.services.web.volumes = [{ target: '/var/lib/smartsite/evidence' }];
    },
  ],
]) {
  test(`${name} remains rejected`, () => {
    const value = config();
    mutate(value);
    assert.throws(() => assertPrivateEvidenceConfig(value, root));
  });
}
