import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneRestrictionPolicy, ZoneType } from '../src/database/entities/enums.js';
import type { ZoneEntity } from '../src/database/entities/zone.entity.js';
import { ZoneAuthorizationService } from '../src/modules/zones/zone-authorization.service.js';

function createZone(restrictionPolicy: ZoneRestrictionPolicy): ZoneEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    siteId: '22222222-2222-4222-8222-222222222222',
    code: 'ZONE-A',
    name: 'Zone A',
    type: ZoneType.RESTRICTED,
    restrictionPolicy,
    requiredPpe: ['HARD_HAT'],
    configurationLocked: false,
    createdAt: new Date(),
  };
}

test('ZoneAuthorizationService: NONE policy returns ALLOWED with no violation subtype', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(createZone(ZoneRestrictionPolicy.NONE));

  assert.equal(result.status, 'ALLOWED');
  assert.equal(result.candidateSubtype, undefined);
});

test('ZoneAuthorizationService: PROHIBITED_FOR_ALL policy returns DENIED and ZONE_ENTRY_PROHIBITED', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(createZone(ZoneRestrictionPolicy.PROHIBITED_FOR_ALL));

  assert.equal(result.status, 'DENIED');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_PROHIBITED');
});

test('ZoneAuthorizationService: AUTHORIZATION_REQUIRED without identity remains UNAVAILABLE', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(
    createZone(ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED),
  );

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
});

test('ZoneAuthorizationService: valid allow grants authorize the identified worker at event time', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(
    createZone(ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED),
    {
      candidateWorkerId: 'WORKER-001',
      workerId: '33333333-3333-4333-8333-333333333333',
      evaluatedAt: new Date('2026-09-28T08:00:00.000Z'),
      authorizationDataAvailable: true,
      grants: [
        {
          effect: 'ALLOW',
          validFrom: new Date('2026-09-28T07:00:00.000Z'),
          validUntil: new Date('2026-09-28T09:00:00.000Z'),
          revokedAt: null,
        },
      ],
    },
  );

  assert.equal(result.status, 'ALLOWED');
  assert.equal(result.workerId, '33333333-3333-4333-8333-333333333333');
});

test('ZoneAuthorizationService: explicit deny overrides an overlapping allow grant', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(
    createZone(ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED),
    {
      candidateWorkerId: 'WORKER-001',
      workerId: '33333333-3333-4333-8333-333333333333',
      evaluatedAt: new Date('2026-09-28T08:00:00.000Z'),
      authorizationDataAvailable: true,
      grants: [
        {
          effect: 'ALLOW',
          validFrom: new Date('2026-09-28T07:00:00.000Z'),
          validUntil: null,
          revokedAt: null,
        },
        {
          effect: 'DENY',
          validFrom: new Date('2026-09-28T07:30:00.000Z'),
          validUntil: null,
          revokedAt: null,
        },
      ],
    },
  );

  assert.equal(result.status, 'DENIED');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(result.reasonCode, 'EXPLICIT_DENY');
});

test('ZoneAuthorizationService: expired, future and revoked grants do not authorize entry', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(
    createZone(ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED),
    {
      candidateWorkerId: 'WORKER-001',
      workerId: '33333333-3333-4333-8333-333333333333',
      evaluatedAt: new Date('2026-09-28T08:00:00.000Z'),
      authorizationDataAvailable: true,
      grants: [
        {
          effect: 'ALLOW',
          validFrom: new Date('2026-09-28T06:00:00.000Z'),
          validUntil: new Date('2026-09-28T07:00:00.000Z'),
          revokedAt: null,
        },
        {
          effect: 'ALLOW',
          validFrom: new Date('2026-09-28T09:00:00.000Z'),
          validUntil: null,
          revokedAt: null,
        },
        {
          effect: 'ALLOW',
          validFrom: new Date('2026-09-28T07:00:00.000Z'),
          validUntil: null,
          revokedAt: new Date('2026-09-28T07:30:00.000Z'),
        },
      ],
    },
  );

  assert.equal(result.status, 'DENIED');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(result.reasonCode, 'NO_VALID_ALLOW');
});

test('ZoneAuthorizationService: a candidate identity cannot use an allow grant without a verified worker', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(
    createZone(ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED),
    {
      candidateWorkerId: 'WORKER-001',
      evaluatedAt: new Date('2026-09-28T08:00:00.000Z'),
      authorizationDataAvailable: true,
      grants: [
        {
          effect: 'ALLOW',
          validFrom: new Date('2026-09-28T07:00:00.000Z'),
          validUntil: new Date('2026-09-28T09:00:00.000Z'),
          revokedAt: null,
        },
      ],
    },
  );

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
  assert.equal(result.reasonCode, 'IDENTITY_UNAVAILABLE');
  assert.equal(result.workerId, undefined);
});

test('ZoneAuthorizationService: an allow grant expires exactly at validUntil', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(
    createZone(ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED),
    {
      candidateWorkerId: 'WORKER-001',
      workerId: '33333333-3333-4333-8333-333333333333',
      evaluatedAt: new Date('2026-09-28T08:00:00.000Z'),
      authorizationDataAvailable: true,
      grants: [
        {
          effect: 'ALLOW',
          validFrom: new Date('2026-09-28T07:00:00.000Z'),
          validUntil: new Date('2026-09-28T08:00:00.000Z'),
          revokedAt: null,
        },
      ],
    },
  );

  assert.equal(result.status, 'DENIED');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(result.reasonCode, 'NO_VALID_ALLOW');
});
