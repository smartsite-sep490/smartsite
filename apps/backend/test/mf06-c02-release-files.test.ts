import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
} from '../src/modules/zones/main-authority-cutover-release.js';

test('the reviewed MF06 release pins the manual identity and result evidence code', () => {
  for (const path of [
    'database/migrations/1795046400016-Mf06RetrospectiveResult.ts',
    'modules/safety/assessments/mf06-retrospective-context.ts',
    'modules/safety/identification/c02-accepted-subject.ts',
  ]) {
    assert.ok(MAIN_AUTHORITY_CUTOVER_RELEASE_FILES.includes('apps/backend/src/' + path), path);
    assert.ok(MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES.includes(path.replace(/\.ts$/, '.js')), path);
  }
});
