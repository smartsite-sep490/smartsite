import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DemoApiClient,
  demoConfiguration,
  ensureDemoConfiguration,
  hasGlobalAdminRole,
} from './mf05-mf06-demo-setup.mjs';

test('recognizes only a global Admin role assignment', () => {
  assert.equal(
    hasGlobalAdminRole({
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    }),
    true,
  );
  assert.equal(
    hasGlobalAdminRole({
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-1' }],
    }),
    false,
  );
  assert.equal(
    hasGlobalAdminRole({
      roleAssignments: [{ role: 'ADMIN', siteId: 'site-1' }],
    }),
    false,
  );
  assert.equal(hasGlobalAdminRole({ roleAssignments: [] }), false);
  assert.equal(hasGlobalAdminRole({}), false);
  assert.equal(hasGlobalAdminRole(null), false);
  assert.equal(hasGlobalAdminRole(undefined), false);
});

class FakeClient {
  constructor() {
    this.sites = [];
    this.cameras = [];
    this.zones = [];
    this.regions = [];
    this.mutations = [];
  }

  page(items) {
    return { items, total: items.length };
  }
  async listSites() {
    return this.page(this.sites);
  }
  async createSite(_token, input) {
    this.mutations.push('site');
    const site = { id: 'site-1', ...input };
    this.sites.push(site);
    return site;
  }
  async listCameras(_token, siteId) {
    return this.page(this.cameras.filter((camera) => camera.siteId === siteId));
  }
  async createCamera(_token, siteId, input) {
    this.mutations.push('camera');
    const camera = {
      id: 'camera-1',
      siteId,
      status: 'ACTIVE',
      configurationVersion: 1,
      ...input,
    };
    this.cameras.push(camera);
    return camera;
  }
  async getCamera(_token, _siteId, cameraId) {
    return this.cameras.find((camera) => camera.id === cameraId);
  }
  async setCameraStatus(_token, _siteId, cameraId, input) {
    const camera = this.cameras.find((item) => item.id === cameraId);
    assert.equal(input.expectedConfigurationVersion, camera.configurationVersion);
    camera.configurationVersion += 1;
    camera.status = input.status;
    this.mutations.push(`camera-status:${input.status}`);
    return camera;
  }
  async listZones(_token, siteId) {
    return this.page(this.zones.filter((zone) => zone.siteId === siteId));
  }
  async createZone(_token, siteId, input) {
    this.mutations.push(`zone:${input.code}`);
    const zone = { id: `zone-${this.zones.length + 1}`, siteId, ...input };
    this.zones.push(zone);
    return zone;
  }
  async listRegions(_token, _siteId, cameraId) {
    return this.page(this.regions.filter((region) => region.cameraId === cameraId));
  }
  async createRegion(_token, _siteId, cameraId, input) {
    const camera = this.cameras.find((item) => item.id === cameraId);
    assert.equal(input.expectedConfigurationVersion, camera.configurationVersion);
    camera.configurationVersion += 1;
    this.mutations.push(`region:${input.zoneId}`);
    const region = {
      id: `region-${this.regions.length + 1}`,
      cameraId,
      zoneId: input.zoneId,
      polygon: input.polygon,
      isActive: true,
    };
    this.regions.push(region);
    return { region, configurationVersion: camera.configurationVersion };
  }
  async setRegionActive(_token, _siteId, cameraId, regionId, input) {
    const camera = this.cameras.find((item) => item.id === cameraId);
    const region = this.regions.find((item) => item.id === regionId);
    assert.equal(input.expectedConfigurationVersion, camera.configurationVersion);
    camera.configurationVersion += 1;
    region.isActive = input.isActive;
    this.mutations.push(`reactivate:${regionId}`);
    return { region, configurationVersion: camera.configurationVersion };
  }
}

test('creates the two-region MF05/MF06 demo configuration with current revisions', async () => {
  const client = new FakeClient();
  const result = await ensureDemoConfiguration(client, 'token');

  assert.deepEqual(client.mutations, [
    'site',
    'camera',
    'zone:PPE-DEMO',
    'zone:RESTRICTED-DEMO',
    'region:zone-1',
    'region:zone-2',
  ]);
  assert.equal(result.configurationVersion, 3);
  assert.equal(result.ppeRegionId, 'region-1');
  assert.equal(result.restrictedRegionId, 'region-2');
  assert.deepEqual(client.zones[0].requiredPpe, ['HARD_HAT', 'SAFETY_VEST']);
  assert.equal(client.zones[1].restrictionPolicy, 'PROHIBITED_FOR_ALL');
});

test('is idempotent when the exact configuration already exists', async () => {
  const client = new FakeClient();
  const first = await ensureDemoConfiguration(client, 'token');
  client.mutations.length = 0;
  const second = await ensureDemoConfiguration(client, 'token');

  assert.deepEqual(second, first);
  assert.deepEqual(client.mutations, []);
});

test('reactivates exact inactive regions using fresh camera revisions', async () => {
  const client = new FakeClient();
  await ensureDemoConfiguration(client, 'token');
  client.regions.forEach((region) => {
    region.isActive = false;
  });
  client.mutations.length = 0;

  const result = await ensureDemoConfiguration(client, 'token');

  assert.deepEqual(client.mutations, ['reactivate:region-1', 'reactivate:region-2']);
  assert.equal(result.configurationVersion, 5);
  assert.ok(client.regions.every((region) => region.isActive));
});

test('reactivates an exact inactive Camera before creating its configuration snapshot', async () => {
  const client = new FakeClient();
  await ensureDemoConfiguration(client, 'token');
  client.cameras[0].status = 'INACTIVE';
  client.mutations.length = 0;

  const result = await ensureDemoConfiguration(client, 'token');

  assert.deepEqual(client.mutations, ['camera-status:ACTIVE']);
  assert.equal(client.cameras[0].status, 'ACTIVE');
  assert.equal(result.configurationVersion, 4);
});

test('fails closed when an existing Zone has a different policy', async () => {
  const client = new FakeClient();
  await ensureDemoConfiguration(client, 'token');
  client.zones[0].requiredPpe = [];

  await assert.rejects(ensureDemoConfiguration(client, 'token'), /different locked policy/);
});

test('fails closed when Camera code and external ID resolve to different records', async () => {
  const client = new FakeClient();
  client.sites.push({ id: 'site-1', ...demoConfiguration.site });
  client.cameras.push(
    {
      id: 'camera-1',
      siteId: 'site-1',
      code: demoConfiguration.camera.code,
      externalId: 'OTHER',
      configurationVersion: 1,
    },
    {
      id: 'camera-2',
      siteId: 'site-1',
      code: 'OTHER',
      externalId: demoConfiguration.camera.externalId,
      configurationVersion: 1,
    },
  );

  await assert.rejects(ensureDemoConfiguration(client, 'token'), /belong to different records/);
});

test('reads every management page before deciding whether a demo record exists', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    const offset = new URL(String(url)).searchParams.get('offset');
    const items =
      offset === '0'
        ? Array.from({ length: 100 }, (_, index) => ({ id: `site-${index}` }))
        : [{ id: 'site-100' }];
    return new Response(JSON.stringify({ items, total: 101 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await new DemoApiClient('http://127.0.0.1:3000').listSites('token');

  assert.equal(result.items.length, 101);
  assert.deepEqual(
    requestedUrls.map((url) => new URL(url).searchParams.get('offset')),
    ['0', '100'],
  );
});
