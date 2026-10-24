import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './index';

const site = '11111111-1111-4111-8111-111111111111';
const camera = '22222222-2222-4222-8222-222222222222';
const region = '33333333-3333-4333-8333-333333333333';
const status = () => ({ siteId: site, cameraId: camera, sourceKind: 'REPLAY', state: 'READY', configurationVersion: 2, selectedRegionId: region, loadedRegionId: region, loadedConfigurationVersion: 2, loadedGeometryVersion: 1, regions: [{id: region, zoneId: region, zoneCode: 'HELMET', geometryVersion: 1, requiredPpe: ['HARD_HAT']}], candidates: [], evidenceImageDataUrl: null, mf08Persisted: false });
afterEach(() => vi.unstubAllGlobals());
it('reads scoped local operator status without putting credentials in URL', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(status())); vi.stubGlobal('fetch', fetcher);
  expect(await new SmartSiteManagementClient('http://localhost:5181').getMf05DemoStatus('private-token',site,camera)).toEqual(status());
  expect(fetcher.mock.calls[0]?.[0]).toBe(`http://localhost:5181/api/v1/sites/${site}/cameras/${camera}/mf05-demo`);
  expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBe('Bearer private-token');
});
it('rejects another camera and a fake persisted-alert claim', async () => {
  const client=new SmartSiteManagementClient('http://localhost:5181');
  for (const payload of [{...status(),cameraId:site},{...status(),mf08Persisted:true}]) {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(client.getMf05DemoStatus('token',site,camera)).rejects.toMatchObject({code:'invalid-response'});
  }
});
it('applies exactly the selected saved region/revision as JSON POST', async () => {
  const fetcher=vi.fn().mockResolvedValue(Response.json({...status(),state:'APPLYING',loadedRegionId:null,loadedConfigurationVersion:null,loadedGeometryVersion:null})); vi.stubGlobal('fetch',fetcher);
  const request={regionId:region,expectedConfigurationVersion:2};
  expect((await new SmartSiteManagementClient('http://localhost:5181').applyMf05DemoRegion('token',site,camera,request)).state).toBe('APPLYING');
  expect(fetcher.mock.calls[0]?.[1].method).toBe('POST'); expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual(request);
});
it('cancelled viewer does not read or apply operator config',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher); const controller=new AbortController();controller.abort();
  const client=new SmartSiteManagementClient('http://localhost:5181');
  await expect(client.getMf05DemoStatus('token',site,camera,{signal:controller.signal})).rejects.toMatchObject({code:'cancelled'});
  expect(fetcher).not.toHaveBeenCalled();
});
