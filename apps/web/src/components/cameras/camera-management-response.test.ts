import { expect, it } from 'vitest';
import type { CameraResponse } from '@smartsite/contracts/management';
import {
  parseRefreshCameraResponse,
  parseRenameCameraResponse,
  parseSetStatusCameraResponse,
} from './camera-management-response';

const current: CameraResponse = {
  id: '10000000-0000-4000-8000-000000000001',
  siteId: '20000000-0000-4000-8000-000000000001',
  type: 'ZONE',
  gateId: null,
  code: 'ZONE-CAM',
  name: 'Zone camera',
  externalId: 'synthetic-source',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-11-01T00:00:00Z',
};

for (const operation of ['rename', 'status', 'refresh'] as const) {
  it(`${operation} preserves camera purpose and Gate binding and rejects changed bindings`, () => {
    const updated = { ...current, name: 'Renamed camera', configurationVersion: 2 };
    const parse = (value: unknown) => {
      if (operation === 'rename')
        return parseRenameCameraResponse(value, { ...current, currentVersion: 1 }, updated.name);
      if (operation === 'status')
        return parseSetStatusCameraResponse(value, {
          ...current,
          currentVersion: 1,
          targetStatus: 'ACTIVE',
        });
      return parseRefreshCameraResponse(value, current);
    };
    expect(parse(updated)).toEqual(updated);
    expect(() => parse({ ...updated, type: 'GATE' })).toThrow();
    expect(() => parse({ ...updated, gateId: '30000000-0000-4000-8000-000000000001' })).toThrow();
    expect(() => parse({ ...updated, type: undefined, gateId: undefined })).toThrow();
  });
}
