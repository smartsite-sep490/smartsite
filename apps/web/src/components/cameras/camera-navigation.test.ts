import { describe, expect, it } from 'vitest';
import { buildCameraSelectionSearch, buildCameraTabTarget } from './camera-navigation';

describe('buildCameraTabTarget', () => {
  it('carries only whitelisted siteId and cameraId across camera workflow routes', () => {
    expect(
      buildCameraTabTarget(
        '/camera-setup',
        '?siteId=site-1&cameraId=cam-setup&action=regions&regionId=reg-9&tab=extra',
        'ppe',
      ),
    ).toBe('/ppe?siteId=site-1&cameraId=cam-setup');

    expect(
      buildCameraTabTarget('/ppe', '?siteId=site-2&cameraId=cam-4&alertId=al-1', 'zones'),
    ).toBe('/zones?siteId=site-2&cameraId=cam-4');

    expect(buildCameraTabTarget('/zones', '?siteId=site-3', 'camera-setup')).toBe(
      '/camera-setup?siteId=site-3',
    );
  });

  it('drops cameraId if siteId is missing or unsafe and drops all params for non-camera routes', () => {
    expect(buildCameraTabTarget('/camera-setup', '?cameraId=cam-only', 'ppe')).toBe('/ppe');
    expect(buildCameraTabTarget('/camera-setup', '?siteId=../bad&cameraId=cam-1', 'ppe')).toBe(
      '/ppe',
    );
    expect(buildCameraTabTarget('/camera-setup', '?siteId=site-1&cameraId=../evil', 'zones')).toBe(
      '/zones?siteId=site-1',
    );
    expect(buildCameraTabTarget('/ppe', '?siteId=site-1&cameraId=cam-1', 'incidents')).toBe(
      '/incidents',
    );
    expect(buildCameraTabTarget('/incidents', '?siteId=site-1&cameraId=cam-1', 'ppe')).toBe('/ppe');
  });
});

describe('buildCameraSelectionSearch', () => {
  it('updates siteId and cameraId while stripping explicitly invalidated params', () => {
    const next = buildCameraSelectionSearch(
      '?siteId=site-1&cameraId=cam-1&action=ppe&regionId=reg-1',
      { siteId: 'site-1', cameraId: 'cam-2' },
      ['action', 'regionId'],
    );
    expect(next.toString()).toBe('siteId=site-1&cameraId=cam-2');
  });

  it('clears cameraId when switching site without cameraId', () => {
    const next = buildCameraSelectionSearch('?siteId=site-1&cameraId=cam-1', {
      siteId: 'site-2',
    });
    expect(next.toString()).toBe('siteId=site-2');
  });
});
