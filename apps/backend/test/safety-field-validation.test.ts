import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { command } from '../src/common/configuration/commands.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { SubmitChecklistDto } from '../src/modules/safety/safety-checklist.commands.js';
import { validateChecklistResults } from '../src/modules/safety/checklist-policy.js';

test('multipart checklist DTO validation retains nested field paths without values', () => {
  assert.throws(
    () =>
      command(SubmitChecklistDto, {
        commandId: '50000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        results: [{ itemId: 'PRIVATE_VALUE', answer: 'PASS', note: '', fileIndexes: [] }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof PublicHttpException);
      assert.ok(error.publicPayload.issues?.some((issue) => issue.path === '/results/0/itemId'));
      assert.ok(!JSON.stringify(error.publicPayload).includes('PRIVATE_VALUE'));
      return true;
    },
  );
});

test('missing checklist evidence identifies the result that needs correction', () => {
  assert.throws(
    () =>
      validateChecklistResults(
        [{ id: 'item', evidenceRequired: true }],
        [{ itemId: 'item', answer: 'PASS', note: '', fileIndexes: [] }],
        0,
      ),
    (error: unknown) => {
      assert.ok(error instanceof PublicHttpException);
      assert.equal(error.publicPayload.issues?.[0]?.path, '/results/0/fileIndexes');
      return true;
    },
  );
});
