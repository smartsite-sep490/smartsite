import { translate as tr } from '../../i18n';
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
      throw new Error(tr('load-all-pages.site_setup_data_is_incomplete_refresh_and_try_again'));
  }
}
