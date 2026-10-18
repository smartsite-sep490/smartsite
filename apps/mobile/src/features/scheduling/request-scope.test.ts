import { expect, it } from 'vitest';
import type { ShiftRequestResponse } from '@smartsite/api-client';
import { requestInScope } from './request-scope';
it('keeps both participants within the selected representative contractor, while allowing incoming swaps to the Worker', () => {
  const swap = {
    requestType: 'SWAP',
    requesterWorkerId: 'worker-b',
    coworkerWorkerId: 'worker-a',
  } as ShiftRequestResponse;
  expect(requestInScope(swap, new Set(['worker-a']), 'worker')).toBe(true);
  expect(requestInScope(swap, new Set(['worker-a']), 'contractor')).toBe(false);
  expect(requestInScope(swap, new Set(['worker-a', 'worker-b']), 'contractor')).toBe(true);
  const change = { requestType: 'CHANGE', workerId: 'other-contractor' } as ShiftRequestResponse;
  expect(requestInScope(change, new Set(['worker-a']), 'contractor')).toBe(false);
});
