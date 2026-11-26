import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReadyRevision, assertServingRevision } from './verify-cloud-run-release.mjs';

const sha = 'a'.repeat(40);
const name = 'smartsite-backend-main-example';
const ready = () => ({
  metadata: { name, labels: { 'smartsite-git-sha': sha } },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
});

test('accepts only the exact new revision with its requested Main commit and Ready state', () => {
  assert.doesNotThrow(() => assertReadyRevision(ready(), name, sha));
  for (const change of [
    (r) => {
      r.status.conditions[0].status = 'False';
    },
    (r) => {
      r.status.conditions = [];
    },
    (r) => {
      r.metadata.name = 'previous-ready-revision';
    },
    (r) => {
      r.metadata.labels['smartsite-git-sha'] = 'b'.repeat(40);
    },
    (r) => {
      delete r.metadata.labels;
    },
  ]) {
    const revision = ready();
    change(revision);
    assert.throws(() => assertReadyRevision(revision, name, sha));
  }
});

test('a previously ready service cannot substitute for a failed newly created revision', () => {
  const service = {
    metadata: { name: 'smartsite-backend' },
    status: {
      latestReadyRevisionName: 'previous-ready-revision',
      latestCreatedRevisionName: name,
      conditions: [{ type: 'Ready', status: 'True' }],
    },
  };
  assert.throws(() => assertReadyRevision(service, name, sha));
});

test('requires 100 percent on the exact revision and ignores non-serving tagged entries', () => {
  const service = {
    status: {
      traffic: [
        { revisionName: 'old', tag: 'rollback' },
        { revisionName: name, percent: 100 },
      ],
    },
  };
  assert.doesNotThrow(() => assertServingRevision(service, name));
  for (const traffic of [
    [
      { revisionName: 'old', percent: 100 },
      { revisionName: name, percent: 0 },
    ],
    [
      { revisionName: name, percent: 50 },
      { revisionName: 'old', percent: 50 },
    ],
    [],
  ])
    assert.throws(() => assertServingRevision({ status: { traffic } }, name));
});
