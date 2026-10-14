import { afterEach, expect, it } from 'vitest';
import i18n from '../../i18n';
import { getPpeVideoTestDetections, type AiVideoTimeline } from './videoTestFixture';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

it.each([
  ['GLOVES', 'Gloves', 'Găng tay'],
  ['BOOTS', 'Boots', 'Giày bảo hộ'],
  ['GOGGLES', 'Goggles', 'Kính bảo hộ'],
] as const)(
  'localizes %s without turning it into Vest or altering timeline evidence',
  async (item, en, vi) => {
    const timeline: AiVideoTimeline = {
      schemaVersion: '1.0.0',
      cameraExternalId: 'fixture-camera',
      entries: [
        {
          videoTimeSeconds: 1,
          event: {
            eventId: 'original-fixture-event',
            cameraExternalId: 'fixture-camera',
            observations: [{ type: 'PPE', trackId: 3, ppeItem: item, status: 'MISSING' }],
          },
        },
      ],
    };
    const original = JSON.stringify(timeline);
    await i18n.changeLanguage('en');
    const [detection] = getPpeVideoTestDetections({ currentTime: 1, duration: 3 }, timeline);
    expect(detection?.label).toBe(`MF04 Missing ${en}`);
    await i18n.changeLanguage('vi');
    expect(detection?.label).toBe(`MF04 Thiếu ${vi}`);
    expect(detection?.eventId).toBe('original-fixture-event');
    expect(detection?.trackId).toBe(3);
    expect(detection?.ppeStatus[item]).toBe('MISSING');
    expect(detection?.ppeStatus.HARD_HAT).toBe('UNKNOWN');
    expect(JSON.stringify(timeline)).toBe(original);
  },
);
