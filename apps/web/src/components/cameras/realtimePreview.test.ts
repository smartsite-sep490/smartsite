import { describe, expect, it } from 'vitest';
import { createPreviewDecoder, parseRealtimePreview } from './realtimePreview';

const packet = {
  type: 'frame',
  previewVersion: 1,
  width: 4,
  height: 2,
  sessionId: '00000000-0000-4000-8000-000000000001',
  sequenceNumber: '9223372036854775807',
  cameraExternalId: 'CAM-01',
  capturedAt: '2026-09-30T00:00:00Z',
  imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  detections: [],
  zoneDetections: [],
};

describe('exact-frame preview', () => {
  it('keeps the inference polygon and rejects unbounded geometry', () => {
    const polygon = {
      regionId: 'region-1',
      geometryVersion: 3,
      coordinates: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    };
    expect(parseRealtimePreview({ ...packet, zonePolygons: [polygon] }).zonePolygons).toEqual([
      polygon,
    ]);
    expect(() =>
      parseRealtimePreview({
        ...packet,
        zonePolygons: [
          {
            ...polygon,
            coordinates: [
              [0, 0],
              [2, 0],
              [1, 1],
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it('accepts outside-zone tracks with a null region without granting permission', () => {
    const frame = parseRealtimePreview({
      ...packet,
      zoneDetections: [
        {
          trackId: 1,
          confidence: 0.8,
          active: false,
          label: 'OUTSIDE ZONE',
          regionId: null,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
        },
      ],
    });
    expect(frame.zoneDetections[0]?.regionId).toBeUndefined();
    expect(frame.zoneDetections[0]?.active).toBe(false);
  });
  it('keeps empty frames and full-range sequence identity without numeric rounding', () => {
    const frame = parseRealtimePreview(packet);
    expect(frame.sequenceNumber).toBe('9223372036854775807');
    expect(frame.detections).toEqual([]);
  });

  it('rejects metadata-only overlays, oversized images and invalid box coordinates', () => {
    expect(() => parseRealtimePreview({ ...packet, imageDataUrl: undefined })).toThrow();
    expect(() => parseRealtimePreview({ ...packet, width: 2000 })).toThrow();
    expect(() =>
      parseRealtimePreview({ ...packet, imageDataUrl: 'https://other.test/img' }),
    ).toThrow();
    expect(() =>
      parseRealtimePreview({
        ...packet,
        detections: [
          {
            trackId: 1,
            confidence: 0.9,
            active: false,
            label: 'Person',
            boundingBox: { x1: 0.9, y1: 0, x2: 0.1, y2: 1 },
          },
        ],
      }),
    ).toThrow();
  });

  it('bounds decode to one active image plus the latest pending frame', async () => {
    const decoded: string[] = [];
    const committed: string[] = [];
    let finish!: (image: string) => void;
    const decoder = createPreviewDecoder<string>(
      async (frame) => {
        decoded.push(frame.sequenceNumber);
        if (frame.sequenceNumber === '1')
          return new Promise((resolve) => {
            finish = resolve;
          });
        return frame.sequenceNumber;
      },
      (frame, image) => committed.push(`${frame.sequenceNumber}:${image}`),
      () => {
        throw new Error('unexpected decode error');
      },
    );
    decoder.push(parseRealtimePreview({ ...packet, sequenceNumber: '1' }));
    decoder.push(parseRealtimePreview({ ...packet, sequenceNumber: '2' }));
    decoder.push(parseRealtimePreview({ ...packet, sequenceNumber: '3' }));
    finish('1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(decoded).toEqual(['1', '3']);
    expect(committed).toEqual(['1:1', '3:3']);
  });

  it('cannot resurrect a stale frame after disconnect or unmount', async () => {
    let finish!: (image: string) => void;
    const committed: string[] = [];
    const decoder = createPreviewDecoder<string>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      (frame) => committed.push(frame.sequenceNumber),
      () => undefined,
    );
    decoder.push(parseRealtimePreview(packet));
    decoder.reset();
    finish('old image');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(committed).toEqual([]);
  });

  it('drops a previous session decode when a camera reconnects', async () => {
    let finish!: (image: string) => void;
    const committed: string[] = [];
    const decoder = createPreviewDecoder<string>(
      async (frame) =>
        frame.sessionId === packet.sessionId
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : 'new image',
      (frame, image) => committed.push(`${frame.sessionId}:${image}`),
      () => undefined,
    );
    decoder.push(parseRealtimePreview(packet));
    const nextSession = '00000000-0000-4000-8000-000000000002';
    decoder.push(parseRealtimePreview({ ...packet, sessionId: nextSession, sequenceNumber: '0' }));
    finish('old image');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(committed).toEqual([`${nextSession}:new image`]);
  });

  it('reports corrupt image decoding and continues to the latest valid frame', async () => {
    const committed: string[] = [];
    let failures = 0;
    const decoder = createPreviewDecoder<string>(
      async (frame) => {
        if (frame.sequenceNumber === '1') throw new Error('corrupt JPEG');
        return frame.sequenceNumber;
      },
      (frame) => committed.push(frame.sequenceNumber),
      () => {
        failures++;
      },
    );
    decoder.push(parseRealtimePreview({ ...packet, sequenceNumber: '1' }));
    decoder.push(parseRealtimePreview({ ...packet, sequenceNumber: '2' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures).toBe(1);
    expect(committed).toEqual(['2']);
  });
});
