import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';

test('a deleted Zone cannot regain an active camera Region, including concurrent delete/reactivate', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const sites = new SiteConfigurationService(db),
      zones = new ZoneConfigurationService(db, sites),
      cameras = new CameraConfigurationService(db, zones, sites),
      site = await sites.create({ code: randomUUID(), name: 'Synthetic Site' });
    const setup = async () => {
      const code = randomUUID(),
        zone = await zones.create(site.id, {
          code,
          name: 'Synthetic Zone',
          type: ZoneType.RESTRICTED,
          restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
          requiredPpe: [],
        }),
        camera = await cameras.create(site.id, {
          type: 'ZONE',
          gateId: null,
          code,
          externalId: code,
          name: 'Synthetic Camera',
        }),
        region = await cameras.createRegion(site.id, camera.id, {
          expectedConfigurationVersion: camera.configurationVersion,
          zoneId: zone.id,
          polygon: {
            coordinates: [
              [0.1, 0.1],
              [0.8, 0.1],
              [0.4, 0.8],
            ],
          },
        });
      return { zone, camera, region };
    };
    const { zone, camera, region } = await setup();
    await assert.rejects(zones.remove(site.id, zone.id));
    const inactive = await cameras.setRegionActive(site.id, camera.id, region.id, {
      expectedConfigurationVersion: region.configurationVersion,
      isActive: false,
    });
    await zones.remove(site.id, zone.id);
    await assert.rejects(
      cameras.setRegionActive(site.id, camera.id, region.id, {
        expectedConfigurationVersion: inactive.configurationVersion,
        isActive: true,
      }),
    );
    const stored = (
      await db.query('SELECT is_active,version FROM camera_observation_region WHERE id=$1', [
        region.id,
      ])
    )[0];
    assert.equal(stored.is_active, false);
    assert.equal(stored.version, inactive.version);
    assert.equal(
      (await cameras.get(site.id, camera.id)).configurationVersion,
      inactive.configurationVersion,
    );
    const race = await setup(),
      off = await cameras.setRegionActive(site.id, race.camera.id, race.region.id, {
        expectedConfigurationVersion: race.region.configurationVersion,
        isActive: false,
      });
    const outcomes = await Promise.allSettled([
      zones.remove(site.id, race.zone.id),
      cameras.setRegionActive(site.id, race.camera.id, race.region.id, {
        expectedConfigurationVersion: off.configurationVersion,
        isActive: true,
      }),
    ]);
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    const final = (
      await db.query(
        'SELECT r.is_active,z.deleted_at IS NOT NULL AS deleted FROM camera_observation_region r JOIN zone z ON z.id=r.zone_id WHERE r.id=$1',
        [race.region.id],
      )
    )[0];
    assert.ok(!(final.is_active && final.deleted));
  } finally {
    await owned.dispose();
  }
});
