import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import type { Page } from '@smartsite/api-client';

export function setupErrorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

/** Setup metadata only; errors never turn retained cached rows into current authority. */
export function useSetupCatalog<T extends { id: string }>(
  queryKey: QueryKey,
  enabled: boolean,
  load: (offset: number, signal: AbortSignal) => Promise<Page<T>>,
) {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const page = await load(pageParam, signal);
      if (
        !page ||
        !Array.isArray(page.items) ||
        page.items.length > 20 ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        (page.items.length === 0 && pageParam < page.total) ||
        page.items.some((row) => !row || typeof row.id !== 'string' || !row.id)
      ) {
        throw new Error('Invalid setup metadata page');
      }
      return page;
    },
    getNextPageParam: (page, _pages, offset) => {
      const next = offset + page.items.length;
      return page.items.length && next < page.total ? next : undefined;
    },
    retry: false,
    gcTime: 0,
  });
  const status = setupErrorStatus(query.error);
  const hardError = status === 401 || status === 403 || status === 404;
  const baseError = Boolean(query.error && (hardError || !query.isFetchNextPageError));
  const rows = new Map<string, T>();
  if (enabled && !baseError) {
    for (const page of query.data?.pages ?? []) {
      for (const row of page.items) if (!rows.has(row.id)) rows.set(row.id, row);
    }
  }
  return {
    ...query,
    rows: [...rows.values()],
    status,
    baseError,
    settledEmpty:
      enabled && query.isSuccess && !query.isFetching && rows.size === 0 && !query.hasNextPage,
    total: query.data?.pages.at(-1)?.total ?? 0,
    loadMore: () => {
      if (!query.isFetching && query.hasNextPage && !baseError)
        void query.fetchNextPage({ cancelRefetch: false });
    },
  };
}
