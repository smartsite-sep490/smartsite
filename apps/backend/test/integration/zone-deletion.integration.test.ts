import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';
import { ZoneEntity } from '../../src/database/entities/zone.entity.js';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorZonePermissionEntity,
  UserEntity,
} from '../../src/database/entities/index.js';
const owned = createIsolatedTestDatabase();
const dataSource = owned.dataSource;
after(async () => {
  await owned.dispose();
});
test('soft deletion hides a Zone, preserves its historical name and denies future edits', async () => {
  await owned.initialize();
  const sites = new SiteConfigurationService(dataSource);
  const zones = new ZoneConfigurationService(dataSource, sites);
  const site = await sites.create({ code: randomUUID(), name: 'Deletion test' });
  const contractorId = randomUUID(),
    participationId = randomUUID(),
    userId = randomUUID();
  const zone = await zones.create(site.id, {
    name: 'Historical area',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: [],
  });
  await dataSource
    .getRepository(ContractorEntity)
    .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor' });
  await dataSource.getRepository(UserEntity).save({
    id: userId,
    username: userId,
    displayName: 'Synthetic manager',
    passwordHash: 'not-login',
  });
  await dataSource.getRepository(ContractorSiteParticipationEntity).save({
    id: participationId,
    contractorId,
    siteId: site.id,
    validFrom: new Date('2026-01-01Z'),
  });
  const permission = await dataSource.getRepository(ContractorZonePermissionEntity).save({
    id: randomUUID(),
    siteContractorId: participationId,
    zoneId: zone.id,
    grantedBy: userId,
    validFrom: new Date('2026-01-01Z'),
    validUntil: new Date('2030-01-01Z'),
  });
  await assert.rejects(zones.remove(site.id, zone.id), /Zone is assigned/);
  await dataSource
    .getRepository(ContractorZonePermissionEntity)
    .update(permission.id, { revokedAt: new Date() });
  await assert.rejects(zones.remove(randomUUID(), zone.id));
  await zones.rename(site.id, zone.id, { name: 'Renamed area' });
  await zones.remove(site.id, zone.id);
  assert.equal((await zones.list(site.id)).total, 0);
  assert.equal(await zones.referenceName(site.id, zone.id), 'Renamed area');
  await assert.rejects(zones.get(site.id, zone.id));
  await assert.rejects(zones.rename(site.id, zone.id, { name: 'Unavailable' }));
  await assert.rejects(zones.remove(site.id, zone.id));
  assert.ok(
    (
      await dataSource
        .getRepository(ZoneEntity)
        .findOne({ where: { id: zone.id }, withDeleted: true })
    )?.deletedAt,
  );
  await assert.rejects(
    dataSource
      .getRepository(ContractorZonePermissionEntity)
      .save({ ...permission, id: randomUUID(), revokedAt: null }),
    /Zone is unavailable/,
  );
});
