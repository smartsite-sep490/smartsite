import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type Mf06AssessmentResponse } from './index';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const assessment: Mf06AssessmentResponse = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  siteId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-27T10:00:00.000Z',
  assessedAt: '2026-10-27T10:00:01.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'UNAVAILABLE',
  reasonCode: 'SERVICE_DISABLED',
  evaluatorVersion: 'synthetic-http-v1',
  provenance: 'UNAVAILABLE',
};
const partial = {
  frameId: assessment.eventId,
  sequenceNumber: '18446744073709551615',
  partCount: 2,
  receivedParts: 1,
  status: 'PARTIAL' as const,
};

for (const frameDelivery of [
  partial,
  { ...partial, receivedParts: 2, status: 'COMPLETE' as const },
]) {
  it(`preserves ${frameDelivery.status} and exact uint64 in assessment detail and list`, async () => {
    const row = { ...assessment, frameDelivery };
    const page = { items: [row], total: 1, offset: 0, limit: 20 };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(row))
      .mockResolvedValueOnce(Response.json(page));
    const client = new SmartSiteManagementClient('http://synthetic.test');
    expect(await client.getMf06Assessment('synthetic-token', row.siteId, row.assessmentId)).toEqual(
      row,
    );
    expect(await client.listMf06Assessments('synthetic-token', row.siteId)).toEqual(page);
  });
}

it('rejects malformed or cross-scope frame delivery responses without falling back to legacy success', async () => {
  const client = new SmartSiteManagementClient('http://synthetic.test');
  for (const row of [
    { ...assessment, frameDelivery: { ...partial, status: 'COMPLETE' } },
    { ...assessment, frameDelivery: { ...partial, sequenceNumber: '18446744073709551616' } },
    { ...assessment, frameDelivery: { ...partial, workerId: assessment.eventId } },
    { ...assessment, frameDelivery: partial, siteId: assessment.eventId },
  ]) {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(row))
      .mockResolvedValueOnce(Response.json({ items: [row], total: 1, offset: 0, limit: 20 }));
    await expect(
      client.getMf06Assessment('synthetic-token', assessment.siteId, assessment.assessmentId),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    await expect(
      client.listMf06Assessments('synthetic-token', assessment.siteId),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});
