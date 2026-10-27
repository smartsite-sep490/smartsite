import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createQualifiedAuthorityFixture } from '../support/qualified-authority-fixture.js';
import { MAIN_AUTHORITY_SNAPSHOT_TABLES } from '../../src/modules/zones/main-authority-read-snapshot.js';

let fixture: Awaited<ReturnType<typeof createQualifiedAuthorityFixture>>;
before(async () => {
  fixture = await createQualifiedAuthorityFixture();
});
after(() => fixture?.dispose());
import * as api from '../../src/modules/zones/main-authority-capture-time.js';

test('original sub-millisecond capture time can use a qualified archive only inside its unchanged time interval', async () => {
  const activated = await fixture.cutover.activate(fixture.request, null);
  const [{ capturedAt }] = await fixture.db.query(
    `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt"`,
  );
  const context = {
    siteId: fixture.siteId,
    zoneId: fixture.zoneId,
    workerId: null,
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
    capturedAt,
  };
  const prepared = await fixture.reader.prepare({ ...context, epochId: activated.epochId });
  assert.equal(prepared.status, 'QUALIFIED');
  if (prepared.status !== 'QUALIFIED') return;
  const raw = capturedAt.replace(/Z$/, '000001Z');
  const quote = (id: string) => '"' + id.replaceAll('"', '""') + '"';
  await fixture.db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query("SET LOCAL lock_timeout='1500ms'");
    await manager.query(
      `LOCK TABLE ${MAIN_AUTHORITY_SNAPSHOT_TABLES.map(
        (table) => `${quote(fixture.schema)}.${quote(table)}`,
      ).join(',')} IN SHARE MODE`,
    );
    await manager.query("SELECT set_config('search_path',quote_ident($1),true)", [fixture.schema]);
    const qualified = await fixture.reader.revalidate(
      manager,
      { ...context, epochId: activated.epochId },
      prepared,
    );
    assert.equal(qualified.status, 'QUALIFIED');
    assert.equal(
      await api.verifySubMillisecondAuthorityBridgeInTx(manager, prepared.archive, raw),
      true,
    );
    assert.equal(
      await api.verifySubMillisecondAuthorityBridgeInTx(
        manager,
        prepared.archive,
        new Date(Date.parse(capturedAt) + 1).toISOString(),
      ),
      false,
    );
    assert.equal(
      await api.verifySubMillisecondAuthorityBridgeInTx(manager, prepared.archive, capturedAt),
      true,
    );
  });
  assert.equal(
    await api.verifySubMillisecondAuthorityBridgeInTx(
      fixture.db.manager,
      prepared.archive,
      capturedAt,
    ),
    false,
  );
});

test('nanosecond parsing preserves offsets, negative epochs and refuses invalid dates', async () => {
  assert.equal(api.parseAuthorityInstantNanoseconds('1970-01-01T00:00:00.000000001Z'), 1n);
  assert.equal(api.parseAuthorityInstantNanoseconds('1969-12-31T23:59:59.999999999Z'), -1n);
  assert.equal(api.parseAuthorityInstantNanoseconds('1970-01-01T07:00:00.000000001+0700'), 1n);
  for (const invalid of [
    '2026-02-30T00:00:00Z',
    '2026-01-01T00:00:00-00:00',
    '2026-01-01T00:00:00.1234567890Z',
  ])
    assert.equal(api.parseAuthorityInstantNanoseconds(invalid), null);
  assert.deepEqual(
    api.resolveSameMillisecondCaptureWindow(
      '1970-01-01T00:00:00.000Z',
      '1970-01-01T00:00:00.000999999Z',
    ),
    { canonicalNs: 0n, rawNs: 999999n },
  );
  assert.equal(
    api.resolveSameMillisecondCaptureWindow('1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.001Z'),
    null,
  );
});
