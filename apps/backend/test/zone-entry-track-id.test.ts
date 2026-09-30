import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateObservationEvent } from '@smartsite/contracts';
import { DataSource } from 'typeorm';
import { ZoneEntryDecisionEntity } from '../src/database/entities/zone-entry-decision.entity.js';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';

class MetadataDataSource extends DataSource {
  async prepareMetadata() {
    await this.buildMetadatas();
  }
}

async function trackColumn() {
  const source = new MetadataDataSource(
    buildTypeOrmOptions({
      DATABASE_URL: 'postgresql://smartsite_test:test_only@127.0.0.1:5433/smartsite_test',
    }),
  );
  await source.prepareMetadata();
  const column = source.getMetadata(ZoneEntryDecisionEntity).findColumnWithPropertyName('trackId');
  assert.ok(column);
  return { source, column };
}

test('Zone decisions store the complete immutable v1 Track ID range without changing JSON numbers', async () => {
  const { source, column } = await trackColumn();
  assert.equal(column.type, 'bigint');
  for (const trackId of [0, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER]) {
    const event = {
      eventId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
      schemaVersion: '1.0.0',
      cameraExternalId: 'cam-test',
      streamSessionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf7',
      capturedAt: '2026-10-01T00:00:00.000Z',
      frameDimensions: { width: 1280, height: 720 },
      observations: [
        {
          type: 'ZONE_ENTRY',
          trackId,
          regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf8',
          geometryVersion: 1,
        },
      ],
      evidence: [],
    };
    assert.equal(validateObservationEvent(event).isValid, true);
    assert.equal(source.driver.preparePersistentValue(trackId, column), String(trackId));
    const hydrated: unknown = source.driver.prepareHydratedValue(String(trackId), column);
    assert.equal(hydrated, trackId);
    assert.equal(JSON.stringify({ trackId: hydrated }), `{"trackId":${trackId}}`);
  }
});

test('Zone Track ID persistence rejects negative, noninteger and unsafe numbers before SQL', async () => {
  const { source, column } = await trackColumn();
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null]) {
    assert.throws(() => source.driver.preparePersistentValue(value, column), RangeError);
  }
});

test('Zone Track ID hydration rejects corrupt or lossy database values', async () => {
  const { source, column } = await trackColumn();
  for (const value of ['-1', '0.5', '9007199254740992', 'NaN', '', ' ', '1e2', '0x10', null]) {
    assert.throws(() => source.driver.prepareHydratedValue(value, column), RangeError);
  }
});
