import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';
import { ZoneEntryAssessmentRequestEntity } from '../src/database/entities/zone-entry-assessment-request.entity.js';
import { ZoneEntryAssessmentJobEntity } from '../src/database/entities/zone-entry-assessment-job.entity.js';
import { ZoneEntryAssessmentEntity } from '../src/database/entities/zone-entry-assessment.entity.js';
import { ZoneEntryAuthorityArtifactEntity } from '../src/database/entities/zone-entry-authority-artifact.entity.js';

test('assessment entities use business names rather than flow-number class names', () => {
  assert.deepEqual(
    [
      ZoneEntryAssessmentRequestEntity.name,
      ZoneEntryAssessmentJobEntity.name,
      ZoneEntryAssessmentEntity.name,
      ZoneEntryAuthorityArtifactEntity.name,
    ],
    [
      'ZoneEntryAssessmentRequestEntity',
      'ZoneEntryAssessmentJobEntity',
      'ZoneEntryAssessmentEntity',
      'ZoneEntryAuthorityArtifactEntity',
    ],
  );
});

test('database-owned UUID metadata does not cause implicit extension installation', () => {
  const options = buildTypeOrmOptions({ DATABASE_URL: 'postgresql://unit:unit@localhost/unit' });
  assert.equal(options.type, 'postgres');
  if (options.type !== 'postgres') throw new Error('PostgreSQL required');
  assert.equal(options.installExtensions, false);
  assert.equal(options.uuidExtension, 'pgcrypto');
});
