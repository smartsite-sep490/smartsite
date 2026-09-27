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

test('ZoneAuthorizationService: AUTHORIZATION_REQUIRED policy returns UNAVAILABLE and ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE', () => {
  const service = new ZoneAuthorizationService();
  const result = service.authorizeZoneEntry(
    createZone(ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED),
  );

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
});

test('ZoneAuthorizationService: never returns ZONE_ENTRY_UNAUTHORIZED in foundation', () => {
  const service = new ZoneAuthorizationService();
  const allPolicies = [
    ZoneRestrictionPolicy.NONE,
    ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
    ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  ];

  for (const policy of allPolicies) {
    const result = service.authorizeZoneEntry(createZone(policy));
    assert.notEqual(result.status as string, 'UNAUTHORIZED');
    assert.notEqual(result.candidateSubtype as string | undefined, 'ZONE_ENTRY_UNAUTHORIZED');
  }
});
