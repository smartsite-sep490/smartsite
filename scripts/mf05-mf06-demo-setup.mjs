import { pathToFileURL } from 'node:url';

const pageSize = 100;
const requestTimeoutMs = 8_000;

export const demoConfiguration = Object.freeze({
  site: { code: 'DEMO-SITE', name: 'SmartSite MF05/MF06 Demo' },
  camera: { code: 'CAM-DEMO-01', externalId: 'CAM-DEMO-01', name: 'Demo Safety Camera' },
  ppeZone: {
    code: 'PPE-DEMO',
    name: 'PPE Monitoring Area',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  },
  restrictedZone: {
    code: 'RESTRICTED-DEMO',
    name: 'Restricted Demo Area',
    type: 'RESTRICTED',
    restrictionPolicy: 'PROHIBITED_FOR_ALL',
    requiredPpe: [],
  },
  ppePolygon: {
    coordinates: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  restrictedPolygon: {
    coordinates: [
      [0.55, 0],
      [1, 0],
      [1, 1],
      [0.55, 1],
    ],
  },
});

function exactlyOne(items, predicate, label) {
  const matches = items.filter(predicate);
  if (matches.length > 1) throw new Error(`Demo configuration has multiple ${label} records.`);
  return matches[0];
}

function sameStrings(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function samePolygon(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertZone(zone, expected, label) {
  if (
    zone.type !== expected.type ||
    zone.restrictionPolicy !== expected.restrictionPolicy ||
    !sameStrings(zone.requiredPpe, expected.requiredPpe)
  ) {
    throw new Error(`${label} exists with a different locked policy; use a clean demo database.`);
  }
}

async function ensureZone(client, token, siteId, expected, label) {
  const page = await client.listZones(token, siteId);
  const zone = exactlyOne(page.items, (item) => item.code === expected.code, label);
  if (zone) {
    assertZone(zone, expected, label);
    return zone;
  }
  return client.createZone(token, siteId, expected);
}

async function ensureRegion(client, token, siteId, cameraId, zoneId, polygon, label) {
  const page = await client.listRegions(token, siteId, cameraId);
  const region = exactlyOne(page.items, (item) => item.zoneId === zoneId, label);
  if (region) {
    if (!samePolygon(region.polygon, polygon)) {
      throw new Error(`${label} exists with different geometry; use a clean demo database.`);
    }
    if (region.isActive) return region;
    const camera = await client.getCamera(token, siteId, cameraId);
    return (
      await client.setRegionActive(token, siteId, cameraId, region.id, {
        expectedConfigurationVersion: camera.configurationVersion,
        isActive: true,
      })
    ).region;
  }
  const camera = await client.getCamera(token, siteId, cameraId);
  return (
    await client.createRegion(token, siteId, cameraId, {
      expectedConfigurationVersion: camera.configurationVersion,
      zoneId,
      polygon,
    })
  ).region;
}

export async function ensureDemoConfiguration(client, token) {
  const sites = await client.listSites(token);
  let site = exactlyOne(
    sites.items,
    (item) => item.code === demoConfiguration.site.code,
    'demo Site',
  );
  site ??= await client.createSite(token, demoConfiguration.site);

  const cameras = await client.listCameras(token, site.id);
  const byCode = exactlyOne(
    cameras.items,
    (item) => item.code === demoConfiguration.camera.code,
    'demo Camera code',
  );
  const byExternalId = exactlyOne(
    cameras.items,
    (item) => item.externalId === demoConfiguration.camera.externalId,
    'demo Camera external ID',
  );
  if (byCode && byExternalId && byCode.id !== byExternalId.id) {
    throw new Error('Demo Camera code and external ID belong to different records.');
  }
  let camera = byCode ?? byExternalId;
  if (camera && camera.externalId !== demoConfiguration.camera.externalId) {
    throw new Error('Demo Camera code exists with a different external ID.');
  }
  if (camera && camera.code !== demoConfiguration.camera.code) {
    throw new Error('Demo Camera external ID exists with a different code.');
  }
  camera ??= await client.createCamera(token, site.id, demoConfiguration.camera);
  if (camera.status !== 'ACTIVE') {
    camera = await client.setCameraStatus(token, site.id, camera.id, {
      expectedConfigurationVersion: camera.configurationVersion,
      status: 'ACTIVE',
    });
  }

  const ppeZone = await ensureZone(
    client,
    token,
    site.id,
    demoConfiguration.ppeZone,
    'PPE demo Zone',
  );
  const restrictedZone = await ensureZone(
    client,
    token,
    site.id,
    demoConfiguration.restrictedZone,
    'restricted demo Zone',
  );
  const ppeRegion = await ensureRegion(
    client,
    token,
    site.id,
    camera.id,
    ppeZone.id,
    demoConfiguration.ppePolygon,
    'PPE demo Region',
  );
  const restrictedRegion = await ensureRegion(
    client,
    token,
    site.id,
    camera.id,
    restrictedZone.id,
    demoConfiguration.restrictedPolygon,
    'restricted demo Region',
  );
  camera = await client.getCamera(token, site.id, camera.id);

  return {
    siteId: site.id,
    cameraId: camera.id,
    cameraExternalId: camera.externalId,
    ppeRegionId: ppeRegion.id,
    restrictedRegionId: restrictedRegion.id,
    configurationVersion: camera.configurationVersion,
  };
}

function safeBackendUrl(value) {
  const url = new URL(value);
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new Error('Demo credentials require HTTPS, except for a loopback Backend URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Backend URL must not contain credentials, query parameters, or a fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}

export class DemoApiClient {
  constructor(baseUrl) {
    this.baseUrl = safeBackendUrl(baseUrl);
  }

  async request(method, path, token, body) {
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (response.status === 204) return undefined;
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && typeof payload.message === 'string'
          ? payload.message
          : `Backend returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    return payload;
  }

  async listAll(path, token) {
    const items = [];
    let offset = 0;
    let total;
    do {
      const separator = path.includes('?') ? '&' : '?';
      const page = await this.request(
        'GET',
        `${path}${separator}offset=${offset}&limit=${pageSize}`,
        token,
      );
      if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total)) {
        throw new Error('Backend returned an invalid paginated response.');
      }
      items.push(...page.items);
      total = page.total;
      offset += page.items.length;
      if (page.items.length === 0 && items.length < total) {
        throw new Error('Backend pagination stopped before all records were returned.');
      }
    } while (items.length < total);
    return { items, total };
  }

  login(username, password) {
    return this.request('POST', '/auth/login', undefined, { username, password });
  }
  changePassword(token, currentPassword, newPassword) {
    return this.request('POST', '/auth/change-password', token, { currentPassword, newPassword });
  }
  logout(token) {
    return this.request('POST', '/auth/logout', token);
  }
  listSites(token) {
    return this.listAll('/sites', token);
  }
  createSite(token, input) {
    return this.request('POST', '/sites', token, input);
  }
  listCameras(token, siteId) {
    return this.listAll(`/sites/${encodeURIComponent(siteId)}/cameras`, token);
  }
  createCamera(token, siteId, input) {
    return this.request('POST', `/sites/${encodeURIComponent(siteId)}/cameras`, token, input);
  }
  getCamera(token, siteId, cameraId) {
    return this.request(
      'GET',
      `/sites/${encodeURIComponent(siteId)}/cameras/${encodeURIComponent(cameraId)}`,
      token,
    );
  }
  setCameraStatus(token, siteId, cameraId, input) {
    return this.request(
      'PATCH',
      `/sites/${encodeURIComponent(siteId)}/cameras/${encodeURIComponent(cameraId)}/status`,
      token,
      input,
    );
  }
  listZones(token, siteId) {
    return this.listAll(`/sites/${encodeURIComponent(siteId)}/zones`, token);
  }
  createZone(token, siteId, input) {
    return this.request('POST', `/sites/${encodeURIComponent(siteId)}/zones`, token, input);
  }
  listRegions(token, siteId, cameraId) {
    return this.listAll(
      `/sites/${encodeURIComponent(siteId)}/cameras/${encodeURIComponent(cameraId)}/regions`,
      token,
    );
  }
  createRegion(token, siteId, cameraId, input) {
    return this.request(
      'POST',
      `/sites/${encodeURIComponent(siteId)}/cameras/${encodeURIComponent(cameraId)}/regions`,
      token,
      input,
    );
  }
  setRegionActive(token, siteId, cameraId, regionId, input) {
    return this.request(
      'PATCH',
      `/sites/${encodeURIComponent(siteId)}/cameras/${encodeURIComponent(cameraId)}/regions/${encodeURIComponent(regionId)}/status`,
      token,
      input,
    );
  }
}

async function main() {
  const username = process.env.SMARTSITE_DEMO_ADMIN_USERNAME;
  let password = process.env.SMARTSITE_DEMO_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'Set SMARTSITE_DEMO_ADMIN_USERNAME and SMARTSITE_DEMO_ADMIN_PASSWORD in the current shell.',
    );
  }
  const client = new DemoApiClient(
    process.env.SMARTSITE_DEMO_BACKEND_URL ?? 'http://127.0.0.1:3000',
  );
  let accessToken;
  try {
    let session = await client.login(username, password);
    accessToken = session.accessToken;
    if (session.user.mustChangePassword) {
      const replacement = process.env.SMARTSITE_DEMO_ADMIN_NEW_PASSWORD;
      if (!replacement) {
        throw new Error(
          'The Admin password is temporary; set SMARTSITE_DEMO_ADMIN_NEW_PASSWORD and run again.',
        );
      }
      await client.changePassword(accessToken, password, replacement);
      await client.logout(accessToken).catch(() => undefined);
      accessToken = undefined;
      password = replacement;
      session = await client.login(username, password);
      accessToken = session.accessToken;
    }
    if (session.user.role !== 'ADMIN') {
      throw new Error('The demo setup requires an Admin account.');
    }
    const result = await ensureDemoConfiguration(client, accessToken);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (accessToken) await client.logout(accessToken).catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Demo setup failed.');
    process.exitCode = 1;
  });
}
