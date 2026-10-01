export function filterManagerReviewRequests<
  TChange extends { status: string },
  TSwap extends { status: string }
>(directChanges: TChange[] = [], swapRequests: TSwap[] = []) {
  const pendingChanges = directChanges.filter((r) => r.status === 'PENDING_MANAGER');
  const pendingSwaps = swapRequests.filter((r) => r.status === 'PENDING_MANAGER');
  return { pendingChanges, pendingSwaps };
}
