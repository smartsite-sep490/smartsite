import { expect, it } from 'vitest';
import { parseSourceHosts, SourceSetupError } from '../src/camera-source';

const host = { id: 'edge', label: 'Site connection', available: false };

it('preserves known source connection reasons without making an unbound camera usable', () => {
  for (const reason of ['CAMERA_UNBOUND', 'AGENT_UNAVAILABLE']) {
    expect(parseSourceHosts({ hosts: [{ ...host, reason }] })).toEqual([{ ...host, reason }]);
  }
});

it('accepts older unavailable responses but rejects unrecognized reason payloads', () => {
  expect(parseSourceHosts({ hosts: [host] })).toEqual([host]);
  for (const reason of ['UNKNOWN', null, { private: 'details' }]) {
    expect(() => parseSourceHosts({ hosts: [{ ...host, reason }] })).toThrow(SourceSetupError);
  }
});
