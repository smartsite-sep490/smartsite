import type { ShiftSwapRequestResponse } from '@smartsite/api-client';

type WorkerSwapRequestReference = Pick<
  ShiftSwapRequestResponse,
  'requesterWorkerId' | 'coworkerWorkerId' | 'status'
>;

export function splitWorkerSwapRequests<T extends WorkerSwapRequestReference>(
  requests: T[],
  workerId: string | null | undefined,
) {
  if (!workerId) {
    return {
      myRequests: [] as T[],
      incomingRequests: [] as T[],
      relatedPendingRequests: [] as T[],
    };
  }

  const relatedRequests = requests.filter(
    (request) =>
      request.requesterWorkerId === workerId || request.coworkerWorkerId === workerId,
  );

  return {
    myRequests: relatedRequests.filter((request) => request.requesterWorkerId === workerId),
    incomingRequests: relatedRequests.filter(
      (request) =>
        request.coworkerWorkerId === workerId && request.status === 'PENDING_COWORKER',
    ),
    relatedPendingRequests: relatedRequests.filter(
      (request) =>
        request.status === 'PENDING_COWORKER' || request.status === 'PENDING_MANAGER',
    ),
  };
}
