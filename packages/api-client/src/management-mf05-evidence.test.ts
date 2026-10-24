import { expect, it } from 'vitest';
import { parseMf05DemoStatus } from './mf05-demo';

const site = '11111111-1111-4111-8111-111111111111';
const camera = '22222222-2222-4222-8222-222222222222';
const region = '33333333-3333-4333-8333-333333333333';
const event = '44444444-4444-4444-8444-444444444444';
const box = { x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.4, coordinateSpace: 'NORMALIZED_0_1' };
function fixture() {
  return {
    siteId: site,
    cameraId: camera,
    sourceKind: 'REPLAY',
    state: 'READY',
    configurationVersion: 4,
    selectedRegionId: region,
    loadedRegionId: region,
    loadedConfigurationVersion: 4,
    loadedGeometryVersion: 1,
    regions: [
      {
        id: region,
        zoneId: region,
        zoneCode: 'ZONE',
        geometryVersion: 1,
        requiredPpe: ['SAFETY_VEST'],
      },
    ],
    candidates: [
      {
        eventId: event,
        capturedAt: '2026-10-08T00:00:00Z',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        ppeItem: 'SAFETY_VEST',
        regionId: region,
        geometryVersion: 1,
        trackId: 3,
        zoneId: region,
      },
    ],
    evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/AA==',
    evidenceFrame: {
      eventId: event,
      capturedAt: '2026-10-08T00:00:00Z',
      frameDimensions: { width: 1920, height: 1080 },
      targets: [
        {
          trackId: 3,
          ppeItem: 'SAFETY_VEST',
          regionId: region,
          geometryVersion: 1,
          personBox: { ...box },
          ppeBox: { ...box },
        },
      ],
    },
    mf08Persisted: false,
  };
}
it('accepts exact candidate event, track and normalized model geometry without interpreting Worker identity', () => {
  const value = fixture();
  expect(parseMf05DemoStatus(value, site, camera)).toEqual(value);
});
it.each(['eventId', 'capturedAt', 'trackId', 'ppeItem', 'regionId', 'geometryVersion'])(
  'rejects JPEG target mismatched to candidate %s',
  (field) => {
    const value = fixture();
    if (field === 'eventId') value.evidenceFrame.eventId = site;
    else if (field === 'capturedAt') value.evidenceFrame.capturedAt = '2026-10-08T00:00:01Z';
    else
      Object.assign(value.evidenceFrame.targets[0]!, {
        [field]:
          field === 'trackId'
            ? 2
            : field === 'geometryVersion'
              ? 2
              : field === 'ppeItem'
                ? 'HARD_HAT'
                : site,
      });
    expect(parseMf05DemoStatus(value, site, camera)).toBeNull();
  },
);
it.each([NaN, Infinity, -0.1, 1.1])('rejects unsafe or outside-image model coordinates %s', (x) => {
  const value = fixture();
  value.evidenceFrame.targets[0]!.personBox.x1 = x;
  expect(parseMf05DemoStatus(value, site, camera)).toBeNull();
});
it('rejects reversed geometry and zero frame dimensions', () => {
  const value = fixture();
  value.evidenceFrame.targets[0]!.ppeBox.x2 = 0;
  expect(parseMf05DemoStatus(value, site, camera)).toBeNull();
  const second = fixture();
  second.evidenceFrame.frameDimensions.width = 0;
  expect(parseMf05DemoStatus(second, site, camera)).toBeNull();
});
it('rejects evidence while applying or metadata without matching JPEG', () => {
  const value = fixture();
  value.state = 'APPLYING';
  expect(parseMf05DemoStatus(value, site, camera)).toBeNull();
  const second = { ...fixture(), evidenceImageDataUrl: null };
  expect(parseMf05DemoStatus(second, site, camera)).toBeNull();
});
it('keeps old status readable without certifying unlinked image identity', () => {
  const { evidenceFrame, ...old } = fixture();
  expect(evidenceFrame).toBeDefined();
  expect(parseMf05DemoStatus(old, site, camera)).toEqual(old);
});
