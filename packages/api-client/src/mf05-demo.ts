/** Local operator adapter. This is not a persisted MF08 alert contract. */
export interface Mf05DemoStatus {
  siteId: string;
  cameraId: string;
  sourceKind: 'LIVE' | 'REPLAY';
  state: 'READY' | 'APPLYING' | 'UNAVAILABLE';
  configurationVersion: number;
  selectedRegionId: string | null;
  loadedRegionId: string | null;
  loadedConfigurationVersion: number | null;
  loadedGeometryVersion: number | null;
  regions: { id: string; zoneId: string; zoneCode: string; geometryVersion: number; requiredPpe: string[] }[];
  candidates: { eventId: string; capturedAt: string; candidateSubtype: string; ppeItem: string; regionId: string; geometryVersion: number; trackId: number; zoneId: string }[];
  evidenceImageDataUrl: string | null;
  /** Exact model evidence for the displayed JPEG, not an authoritative Worker identity. */
  evidenceFrame?: {
    eventId: string;
    capturedAt: string;
    frameDimensions: { width: number; height: number };
    targets: {
      trackId: number; ppeItem: string; regionId: string; geometryVersion: number;
      personBox: Mf05EvidenceBox | null;
      ppeBox: Mf05EvidenceBox | null;
    }[];
  } | null;
  mf08Persisted: false;
}
export interface Mf05EvidenceBox {
  x1: number; y1: number; x2: number; y2: number;
  coordinateSpace: 'NORMALIZED_0_1';
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const items = new Set(['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']);
const box = (v: unknown): boolean => v === null || (object(v) && v.coordinateSpace === 'NORMALIZED_0_1' &&
  [v.x1,v.y1,v.x2,v.y2].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
  Number(v.x1) < Number(v.x2) && Number(v.y1) < Number(v.y2));
export function parseMf05DemoStatus(payload: unknown, siteId: string, cameraId: string): Mf05DemoStatus | null {
  if (!object(payload) || payload.siteId !== siteId || payload.cameraId !== cameraId || !uuid(siteId) || !uuid(cameraId) || payload.mf08Persisted !== false || !['LIVE','REPLAY'].includes(String(payload.sourceKind)) || !['READY','APPLYING','UNAVAILABLE'].includes(String(payload.state)) || !version(payload.configurationVersion)) return null;
  if (![payload.selectedRegionId,payload.loadedRegionId].every(v => v === null || uuid(v))) return null;
  if (![payload.loadedConfigurationVersion,payload.loadedGeometryVersion].every(v => v === null || version(v))) return null;
  if (payload.loadedConfigurationVersion !== null && Number(payload.loadedConfigurationVersion) > payload.configurationVersion) return null;
  if (!Array.isArray(payload.regions) || payload.regions.length > 200 || !Array.isArray(payload.candidates) || payload.candidates.length > 10) return null;
  for (const r of payload.regions) {
    if (!object(r) || !uuid(r.id) || !uuid(r.zoneId) || typeof r.zoneCode !== 'string' || r.zoneCode.length > 64 || !version(r.geometryVersion) || !Array.isArray(r.requiredPpe) || r.requiredPpe.some(v => !items.has(String(v)))) return null;
  }
  if (new Set(payload.regions.map(r => r.id)).size !== payload.regions.length) return null;
  for (const c of payload.candidates) {
    if (!object(c) || !uuid(c.eventId) || !uuid(c.regionId) || !uuid(c.zoneId) || typeof c.capturedAt !== 'string' || !Number.isFinite(Date.parse(c.capturedAt)) || !items.has(String(c.ppeItem)) || c.candidateSubtype !== `PPE_${c.ppeItem}_MISSING` || !version(c.geometryVersion) || !version(c.trackId)) return null;
    const r = payload.regions.find(r => r.id === c.regionId);
    if (!r || r.zoneId !== c.zoneId || r.geometryVersion !== c.geometryVersion || !r.requiredPpe.includes(c.ppeItem)) return null;
  }
  if (payload.evidenceImageDataUrl !== null && (typeof payload.evidenceImageDataUrl !== 'string' || payload.evidenceImageDataUrl.length > 1_000_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.evidenceImageDataUrl))) return null;
  const frame = payload.evidenceFrame;
  if (frame !== undefined && frame !== null) {
    if (payload.state !== 'READY' || payload.evidenceImageDataUrl === null || !object(frame) || !uuid(frame.eventId) || typeof frame.capturedAt !== 'string' || !Number.isFinite(Date.parse(frame.capturedAt)) || !object(frame.frameDimensions) || !version(frame.frameDimensions.width) || !version(frame.frameDimensions.height) || !Array.isArray(frame.targets) || !frame.targets.length || frame.targets.length > 10) return null;
    const keys = new Set<string>();
    for (const t of frame.targets) {
      if (!object(t) || !version(t.trackId) || !items.has(String(t.ppeItem)) || !uuid(t.regionId) || !version(t.geometryVersion) || !box(t.personBox) || !box(t.ppeBox)) return null;
      if (!payload.candidates.some(c => c.eventId === frame.eventId && c.capturedAt === frame.capturedAt && c.trackId === t.trackId && c.ppeItem === t.ppeItem && c.regionId === t.regionId && c.geometryVersion === t.geometryVersion)) return null;
      const key = `${t.trackId}/${t.ppeItem}/${t.regionId}/${t.geometryVersion}`;
      if (keys.has(key)) return null;
      keys.add(key);
    }
  }
  return payload as unknown as Mf05DemoStatus;
}
