import type { Page } from '@smartsite/contracts';

export async function loadAllPages<T>(
  fetchPage: (options: { offset: number; limit: number }) => Promise<Page<T>>,
  signal?: AbortSignal,
): Promise<Page<T>> {
  const items: T[] = [];
  while (true) {
    signal?.throwIfAborted();
    const result = await fetchPage({ offset: items.length, limit: 100 });
    signal?.throwIfAborted();
    items.push(...result.items);
    if (items.length >= result.total) return { items, total: items.length };
    if (result.items.length === 0)
      throw new Error('Site setup data is incomplete. Refresh and try again.');
  }
}
