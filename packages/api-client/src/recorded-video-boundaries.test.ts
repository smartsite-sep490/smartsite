import {describe,it,expect,vi,afterEach} from 'vitest';
import {SmartSiteManagementClient} from './management';
const oldFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=oldFetch;vi.restoreAllMocks();});
const client=()=>new SmartSiteManagementClient('http://localhost:3000');
describe('recorded media body and scope boundaries',()=>{
 it('rejects a missing camera header instead of accepting an unscoped blob',async()=>{globalThis.fetch=vi.fn().mockResolvedValue(new Response('1234ftypisom',{headers:{'content-type':'video/mp4'}}));await expect(client().readRecordedCameraVideo('t','s','c',{expectedCameraExternalId:'replay'})).rejects.toMatchObject({code:'invalid-response'});});
 it('cancels oversized bodies incrementally without waiting for EOF',async()=>{let cancelled=false;globalThis.fetch=vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2000001));},cancel(){cancelled=true;}}),{headers:{'content-type':'video/mp4','x-camera-external-id':'replay'}}));await expect(client().readRecordedCameraVideo('t','s','c',{expectedCameraExternalId:'replay'})).rejects.toMatchObject({code:'invalid-response'});expect(cancelled).toBe(true);},500);
 it('keeps timeout active through a stalled body and cancels its reader',async()=>{let cancelled=false;globalThis.fetch=vi.fn().mockResolvedValue(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'video/mp4','x-camera-external-id':'replay'}}));await expect(client().readRecordedCameraVideo('t','s','c',{expectedCameraExternalId:'replay',timeoutMs:20})).rejects.toMatchObject({code:'timeout'});expect(cancelled).toBe(true);},500);
});
