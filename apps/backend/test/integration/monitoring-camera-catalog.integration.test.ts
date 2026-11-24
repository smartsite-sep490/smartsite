import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../src/config/environment.js';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { GateEntity } from '../../src/database/entities/gate.entity.js';
import { CameraStatus } from '../../src/database/entities/enums.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { CameraPreviewService } from '../../src/modules/cameras/camera-preview.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(() => owned.initialize());
after(() => owned.dispose());

test('monitoring catalog filters gate cameras before pagination while configuration retains every camera', async () => {
  const sites = new SiteConfigurationService(db);
  const cameras = new CameraConfigurationService(
    db,
    new ZoneConfigurationService(db, sites),
    sites,
  );
  const suffix = randomUUID().slice(0, 8);
  const site = await sites.create({ code: `MON-${suffix}`, name: 'Synthetic monitoring site' });
  const otherSite = await sites.create({ code: `OTHER-${suffix}`, name: 'Other synthetic site' });
  for (const [code, type] of [
    ['A-GATE', 'GATE'],
    ['B-ZONE', 'ZONE'],
    ['C-GATE', 'GATE'],
    ['D-ZONE', 'ZONE'],
    ['E-ZONE', 'ZONE'],
  ] as const) {
    const gate =
      type === 'GATE'
        ? await db.getRepository(GateEntity).save({
            id: randomUUID(),
            siteId: site.id,
            code,
            name: 'Synthetic gate',
          })
        : null;
    await cameras.create(site.id, {
      code,
      type,
      gateId: gate?.id ?? null,
      ...(type === 'ZONE' ? { externalId: `${suffix}-${code}` } : {}),
      name: code,
    });
  }
  await db
    .getRepository(CameraEntity)
    .update({ siteId: site.id, code: 'D-ZONE' }, { status: CameraStatus.INACTIVE });
  for (const role of [UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER]) {
    const auth = {
      async authenticate() {
        return {
          user: {
            id: randomUUID(),
            isActive: true,
            mustChangePassword: false,
            roleAssignments: [{ role, siteId: site.id }],
          },
        };
      },
    } as unknown as AuthService;
    const preview = new CameraPreviewService(
      {} as ConfigService<BackendEnvironment, true>,
      auth,
      cameras,
    );
    const first = await preview.list('synthetic-token', site.id, 0, 1);
    const second = await preview.list('synthetic-token', site.id, 1, 1);
    const end = await preview.list('synthetic-token', site.id, 3, 1);
    assert.equal(first.total, 3);
    assert.deepEqual(
      first.items.map((camera) => camera.code),
      ['B-ZONE'],
    );
    assert.equal(second.total, 3);
    assert.deepEqual(
      second.items.map((camera) => camera.code),
      ['D-ZONE'],
    );
    assert.equal(second.items[0]?.status, CameraStatus.INACTIVE);
    assert.equal(end.total, 3);
    assert.deepEqual(end.items, []);
    await assert.rejects(
      preview.list('synthetic-token', otherSite.id, 0, 20),
      (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 403,
    );
  }
  const configuration = await cameras.list(site.id, 0, 20);
  assert.equal(configuration.total, 5);
  assert.deepEqual(
    configuration.items.map((camera) => camera.code),
    ['A-GATE', 'B-ZONE', 'C-GATE', 'D-ZONE', 'E-ZONE'],
  );
});
