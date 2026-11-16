import type { QueryClient } from '@tanstack/react-query';

// One Backend preview handler has a shared 120/minute IP budget, not one per camera.
const BURST = 4;
const REFILL_MS = 650;
interface PendingRead {
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: unknown) => void;
  abort: () => void;
}
interface Budget {
  tokens: number;
  updatedAt: number;
  blockedUntil: number;
  queue: PendingRead[];
  timer?: ReturnType<typeof setTimeout>;
}
const budgets = new WeakMap<QueryClient, Map<string, Budget>>();

function budgetFor(client: QueryClient, apiUrl: string): Budget {
  let byServer = budgets.get(client);
  if (!byServer) budgets.set(client, (byServer = new Map()));
  const server = new URL(apiUrl, typeof window === 'undefined' ? undefined : window.location.href)
    .origin;
  let budget = byServer.get(server);
  if (!budget) {
    budget = { tokens: BURST, updatedAt: Date.now(), blockedUntil: 0, queue: [] };
    byServer.set(server, budget);
  }
  return budget;
}

function drain(budget: Budget) {
  clearTimeout(budget.timer);
  budget.timer = undefined;
  const now = Date.now();
  budget.tokens = Math.min(BURST, budget.tokens + Math.max(0, now - budget.updatedAt) / REFILL_MS);
  budget.updatedAt = Math.max(now, budget.updatedAt);
  while (budget.queue.length && budget.tokens >= 1 && now >= budget.blockedUntil) {
    const pending = budget.queue.shift()!;
    pending.signal.removeEventListener('abort', pending.abort);
    if (pending.signal.aborted) pending.reject(pending.signal.reason);
    else {
      budget.tokens--;
      pending.resolve();
    }
  }
  if (budget.queue.length) {
    const delay = Math.max(
      0,
      budget.blockedUntil - now,
      Math.ceil((1 - budget.tokens) * REFILL_MS),
    );
    budget.timer = setTimeout(() => drain(budget), delay);
  }
}

/** Stores no credentials or pixels; cancellation removes the waiting read before transport. */
export function waitForPreviewRead(
  client: QueryClient,
  apiUrl: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const budget = budgetFor(client, apiUrl);
  return new Promise((resolve, reject) => {
    const pending: PendingRead = {
      signal,
      resolve,
      reject,
      abort: () => {
        const index = budget.queue.indexOf(pending);
        if (index >= 0) budget.queue.splice(index, 1);
        reject(signal.reason);
        drain(budget);
      },
    };
    signal.addEventListener('abort', pending.abort, { once: true });
    budget.queue.push(pending);
    drain(budget);
  });
}

export function deferPreviewReads(client: QueryClient, apiUrl: string, retryAfterSeconds?: number) {
  const budget = budgetFor(client, apiUrl);
  const delay = Number.isFinite(retryAfterSeconds) ? (retryAfterSeconds as number) * 1000 : 4000;
  budget.blockedUntil = Math.max(
    budget.blockedUntil,
    Date.now() + Math.min(60000, Math.max(1000, delay)),
  );
  drain(budget);
}
