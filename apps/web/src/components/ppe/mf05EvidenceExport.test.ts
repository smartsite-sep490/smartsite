// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import type {Mf05DemoStatus} from '@smartsite/api-client';
import {buildMf05EvidenceExport,downloadMf05EvidenceExport} from './mf05EvidenceExport';
const site='11111111-1111-4111-8111-111111111111',camera='22222222-2222-4222-8222-222222222222',region='33333333-3333-4333-8333-333333333333',event='44444444-4444-4444-8444-444444444444';
function fixture():Mf05DemoStatus{
 const candidate={eventId:event,capturedAt:'2026-10-08T00:00:00Z',trackId:3,ppeItem:'SAFETY_VEST',candidateSubtype:'PPE_SAFETY_VEST_MISSING',regionId:region,geometryVersion:1,zoneId:region};
 return {siteId:site,cameraId:camera,state:'READY',sourceKind:'REPLAY',configurationVersion:4,selectedRegionId:region,loadedRegionId:region,loadedConfigurationVersion:4,loadedGeometryVersion:1,regions:[{id:region,zoneId:region,zoneCode:'ZONE',geometryVersion:1,requiredPpe:['SAFETY_VEST']}],candidates:[candidate],evidenceImageDataUrl:'data:image/jpeg;base64,/9j/AA==',evidenceFrame:{eventId:event,capturedAt:candidate.capturedAt,frameDimensions:{width:640,height:480},targets:[{trackId:3,ppeItem:'SAFETY_VEST',regionId:region,geometryVersion:1,personBox:null,ppeBox:{x1:.1,y1:.2,x2:.2,y2:.3,coordinateSpace:'NORMALIZED_0_1'}}]},mf08Persisted:false};
}
afterEach(()=>vi.restoreAllMocks());
it('exports only exact latest candidate original JPEG and technical metadata',()=>{
 const s=fixture();s.candidates.push({...s.candidates[0]!,eventId:site});const p=buildMf05EvidenceExport(s)!;
 expect(p.format).toBe('mf05-candidate-evidence/v1');expect(p.evidenceImageDataUrl).toBe(s.evidenceImageDataUrl);expect(p.candidates).toHaveLength(1);expect(p.evidenceFrame).toEqual(s.evidenceFrame);expect(p.mf08Persisted).toBe(false);expect(p.modelAcceptance).toBe(false);expect(p.groundTruth).toBe(false);
});
it('omits unexpected token/session/source-config fields at every payload layer',()=>{
 const s=fixture();Object.assign(s,{token:'secret-root',rtsp:'secret-camera'});Object.assign(s.evidenceFrame!,{session:'secret-frame'});Object.assign(s.evidenceFrame!.targets[0]!.ppeBox!,{token:'secret-box'});Object.assign(s.candidates[0]!,{workerId:'secret-worker'});
 expect(JSON.stringify(buildMf05EvidenceExport(s))).not.toMatch(/secret|workerId|rtsp|token|session/i);
});
it.each(['APPLYING','UNAVAILABLE'] as const)('refuses %s evidence',state=>{const s=fixture();s.state=state;expect(buildMf05EvidenceExport(s)).toBeNull();});
it('refuses missing metadata/image or mismatched current loaded region',()=>{
 for(const s of [{...fixture(),evidenceFrame:null},{...fixture(),evidenceImageDataUrl:null},{...fixture(),loadedRegionId:site}])expect(buildMf05EvidenceExport(s)).toBeNull();
});
it('refuses mismatched target time, region and unsafe geometry',()=>{
 let s=fixture();s.evidenceFrame!.capturedAt='2026-10-08T00:00:01Z';expect(buildMf05EvidenceExport(s)).toBeNull();
 s=fixture();s.evidenceFrame!.targets[0]!.regionId=site;expect(buildMf05EvidenceExport(s)).toBeNull();
 s=fixture();s.evidenceFrame!.targets[0]!.ppeBox!.x1=-1;expect(buildMf05EvidenceExport(s)).toBeNull();
});
it('detaches exported geometry from future polling mutation',()=>{const s=fixture(),p=buildMf05EvidenceExport(s)!;s.evidenceFrame!.targets[0]!.ppeBox!.x1=.15;expect(p.evidenceFrame.targets[0]!.ppeBox!.x1).toBe(.1);});
it('invalid status cannot trigger a download',()=>{const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});expect(downloadMf05EvidenceExport({...fixture(),state:'APPLYING'})).toBe(false);expect(click).not.toHaveBeenCalled();});
it('downloads JSON through local blob with safe event filename, no network',async()=>{
 const create=vi.fn().mockReturnValue('blob:local-evidence'),revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=create;static revokeObjectURL=revoke;});
 const clicked:HTMLAnchorElement[]=[];vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){clicked.push(this);});
 expect(downloadMf05EvidenceExport(fixture())).toBe(true);expect(clicked[0]!.download).toBe(`mf05-evidence-${event}.json`);expect(clicked[0]!.href).toBe('blob:local-evidence');expect(create.mock.calls[0]![0].type).toBe('application/json');expect(document.querySelector('a[download]')).toBeNull();await vi.waitFor(()=>expect(revoke).toHaveBeenCalledWith('blob:local-evidence'));vi.unstubAllGlobals();
});
