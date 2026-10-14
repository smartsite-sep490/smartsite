import {parseMf05DemoStatus,type Mf05DemoStatus} from '@smartsite/api-client';

/** Local technical evidence handoff. Never serialize authentication or an entire status object. */
export function buildMf05EvidenceExport(status:Mf05DemoStatus){
 if(!parseMf05DemoStatus(status,status.siteId,status.cameraId)||status.state!=='READY'||!status.evidenceFrame||!status.evidenceImageDataUrl)return null;
 const frame=status.evidenceFrame;
 if(status.selectedRegionId!==status.loadedRegionId||frame.targets.some(t=>t.regionId!==status.loadedRegionId||t.geometryVersion!==status.loadedGeometryVersion))return null;
 const box=(b:NonNullable<typeof frame.targets[number]['ppeBox']>|null)=>b?{x1:b.x1,y1:b.y1,x2:b.x2,y2:b.y2,coordinateSpace:b.coordinateSpace}:null;
 const candidates=status.candidates.filter(c=>c.eventId===frame.eventId&&c.capturedAt===frame.capturedAt&&frame.targets.some(t=>t.trackId===c.trackId&&t.ppeItem===c.ppeItem&&t.regionId===c.regionId&&t.geometryVersion===c.geometryVersion)).map(c=>({eventId:c.eventId,capturedAt:c.capturedAt,candidateSubtype:c.candidateSubtype,ppeItem:c.ppeItem,regionId:c.regionId,geometryVersion:c.geometryVersion,trackId:c.trackId,zoneId:c.zoneId}));
 return {
  format:'mf05-candidate-evidence/v1' as const,
  siteId:status.siteId,cameraId:status.cameraId,sourceKind:status.sourceKind,
  loadedConfigurationVersion:status.loadedConfigurationVersion,
  evidenceFrame:{eventId:frame.eventId,capturedAt:frame.capturedAt,frameDimensions:{width:frame.frameDimensions.width,height:frame.frameDimensions.height},targets:frame.targets.map(t=>({trackId:t.trackId,ppeItem:t.ppeItem,regionId:t.regionId,geometryVersion:t.geometryVersion,personBox:box(t.personBox),ppeBox:box(t.ppeBox)}))},
  candidates,evidenceImageDataUrl:status.evidenceImageDataUrl,
  mf08Persisted:false as const,modelAcceptance:false as const,groundTruth:false as const,
 };
}

export function downloadMf05EvidenceExport(status:Mf05DemoStatus):boolean{
 const evidence=buildMf05EvidenceExport(status);if(!evidence)return false;
 const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=`mf05-evidence-${evidence.evidenceFrame.eventId}.json`;
 try{document.body.append(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
 return true;
}
