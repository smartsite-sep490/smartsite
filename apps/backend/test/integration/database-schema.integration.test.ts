import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import dataSource from '../../src/database/typeorm.data-source.js';

async function withDataSource<T>(fn: (source: DataSource) => Promise<T>): Promise<T> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  try {
    return await fn(dataSource);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

test('foundation migration creates required tables and named event id constraint', async () => {
  await withDataSource(async (source) => {
    const rows = await source.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'pk_ai_observation_event_event_id'`,
    );
    assert.equal(rows.length, 1);
    const tables = await source.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('site','camera','zone','camera_observation_region','ai_observation_event','safety_alert','alert_detection_mapping')`,
    );
    assert.equal(tables.length, 7);
  });
});
