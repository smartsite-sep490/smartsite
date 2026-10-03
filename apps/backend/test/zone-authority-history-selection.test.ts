import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ZoneAuthoritySourceKind } from '../src/database/entities/index.js';
import { selectAuthorityHistory } from '../src/modules/zones/zone-authority-history-selection.js';
import {
  AUTHORITY_HISTORY_FACT_LIMIT,
  AUTHORITY_SNAPSHOT_BYTE_LIMIT,
  type AuthorityHistoryRow,
} from '../src/modules/zones/zone-authority-reader.port.js';

const contractorId = randomUUID();
function row(
  revision = '1',
  effectiveFrom = '2026-10-01T00:00:00Z',
  active = true,
): AuthorityHistoryRow {
  return {
    id: randomUUID(),
    commandId: randomUUID(),
    revision,
    recordedAt: new Date(effectiveFrom),
    sourceKind: ZoneAuthoritySourceKind.CONTRACTOR_STATE,
    sourceId: contractorId,
    siteId: null,
    effectiveFrom: new Date(effectiveFrom),
    effectiveTo: null,
    payload: { contractorId, isActive: active },
  };
}
function evidence(facts: AuthorityHistoryRow[]) {
  const latest = facts[facts.length - 1]!;
  return {
    facts,
    sources: [
      {
        sourceKind: latest.sourceKind,
        sourceId: latest.sourceId,
        siteId: latest.siteId,
        payload: latest.payload,
      },
    ],
  };
}
const at = new Date('2026-10-02T00:00:00Z');

test('history selects event-time state, preserving later negative facts and current closure proof', () => {
  const first = row(),
    later = row('2', '2026-10-03T00:00:00Z', false);
  const result = selectAuthorityHistory(evidence([first, later]), at);
  assert.equal(result.status, 'SELECTED');
  if (result.status === 'SELECTED') {
    assert.deepEqual(result.selected[0]?.payload, { contractorId, isActive: true });
    assert.equal(result.evidence.facts.length, 2);
    assert.equal(result.evidence.sources[0]?.payload.isActive, false);
  }
});

test('exact effective boundary chooses the new revision and an expired latest state never resurrects the old one', () => {
  const first = row(),
    next = row('2', at.toISOString(), false);
  const selected = selectAuthorityHistory(evidence([first, next]), at);
  assert.equal(selected.status, 'SELECTED');
  if (selected.status === 'SELECTED') assert.equal(selected.selected[0]?.revision, '2');
  next.effectiveTo = new Date('2026-10-03T00:00:00Z');
  const expired = selectAuthorityHistory(evidence([first, next]), next.effectiveTo);
  assert.equal(expired.status, 'SELECTED');
  if (expired.status === 'SELECTED') assert.equal(expired.selected.length, 0);
});

test('missing history, unaudited projection drift, revision gaps and backwards effective time are unavailable', () => {
  const first = row();
  const missing = { facts: [], sources: evidence([first]).sources };
  const drift = evidence([first]);
  drift.sources[0]!.payload = { contractorId, isActive: false };
  for (const input of [
    missing,
    drift,
    evidence([first, row('3')]),
    evidence([row('1', '2026-10-03T00:00:00Z'), row('2')]),
  ]) {
    assert.equal(selectAuthorityHistory(input, at).status, 'UNAVAILABLE');
  }
});

test('strict rows reject malformed payload, duplicate fact IDs, extra fields and scope/source mismatch', () => {
  const first = row();
  for (const input of [
    { ...evidence([first]), extra: true },
    evidence([
      {
        ...first,
        payload: { ...first.payload, passwordHash: 'forbidden' },
      } as unknown as AuthorityHistoryRow,
    ]),
    evidence([{ ...first, sourceId: randomUUID() }]),
    evidence([first, { ...row('2'), id: first.id }]),
    evidence([{ ...first, recordedAt: new Date(NaN) }]),
  ])
    assert.equal(selectAuthorityHistory(input, at).status, 'UNAVAILABLE');
});

test('large or non-JSON history fails closed rather than returning truncated selected state', () => {
  const first = row();
  const overflow = {
    ...evidence([first]),
    facts: Array(AUTHORITY_HISTORY_FACT_LIMIT + 1).fill(first),
  };
  assert.deepEqual(selectAuthorityHistory(overflow, at), {
    status: 'UNAVAILABLE',
    reason: 'RESOURCE_LIMIT',
  });
  assert.deepEqual(
    selectAuthorityHistory({ padding: 'x'.repeat(AUTHORITY_SNAPSHOT_BYTE_LIMIT) }, at),
    {
      status: 'UNAVAILABLE',
      reason: 'RESOURCE_LIMIT',
    },
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(selectAuthorityHistory(circular, at).status, 'UNAVAILABLE');
});
