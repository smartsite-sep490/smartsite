import { describe, expect, it } from 'vitest';
import { cameraPixelReadiness } from './gateCameraReadiness';
describe('automatic scan camera guard', () => {
  it('blocks black, dark noise and uniform empty frames before sending a JPEG', () => {
    expect(cameraPixelReadiness([0, 0, 0, 255, 8, 8, 8, 255])).toBe('DARK');
    expect(cameraPixelReadiness([10, 8, 30, 255, 20, 5, 40, 255])).toBe('DARK');
    expect(cameraPixelReadiness([128, 128, 128, 255, 128, 128, 128, 255])).toBe('BLANK');
    expect(cameraPixelReadiness([70, 70, 70, 255, 180, 180, 180, 255])).toBe('READY');
  });
});
