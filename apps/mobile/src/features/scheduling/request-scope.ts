import type { ShiftRequestResponse } from '@smartsite/api-client';
export function requestInScope(
  request: ShiftRequestResponse,
  workerIds: ReadonlySet<string>,
  role: 'worker' | 'contractor',
) {
  if (request.requestType === 'CHANGE') return workerIds.has(request.workerId);
  return role === 'worker'
    ? workerIds.has(request.requesterWorkerId) || workerIds.has(request.coworkerWorkerId)
    : workerIds.has(request.requesterWorkerId) && workerIds.has(request.coworkerWorkerId);
}
