import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';

/** Raw page lengths advance offsets; appending never changes selected IDs. */
export function useMonitorPages<T extends { id: string }>(
  scope: string,
  kind: string,
  enabled: boolean,
  read: (offset: number, signal: AbortSignal) => Promise<{ items: T[]; total: number }>,
) {
  const query = useInfiniteQuery({
    queryKey: ['ppe-monitor-pages', scope, kind],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const page = await read(pageParam, signal);
      if (
        !Array.isArray(page.items) ||
        page.items.length > 20 ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        (page.items.length === 0 && page.total > pageParam) ||
        page.items.some((item) => !item || typeof item.id !== 'string' || !item.id)
      ) {
        throw new Error('Invalid or nonprogressing metadata page');
      }
      return { ...page, offset: pageParam };
    },
    getNextPageParam: (page) =>
      page.items.length && page.offset + page.items.length < page.total
        ? page.offset + page.items.length
        : undefined,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    gcTime: 0,
  });
  const revoked =
    query.error instanceof ApiError && [401, 403, 404].includes(query.error.status ?? 0);
  const rows =
    revoked || (query.isError && !query.isFetchNextPageError)
      ? []
      : [
          ...new Map(
            query.data?.pages.flatMap((page) =>
              page.items.map((item) => [item.id, item] as const),
            ) ?? [],
          ).values(),
        ];
  return { ...query, rows, total: query.data?.pages.at(-1)?.total ?? null };
}
