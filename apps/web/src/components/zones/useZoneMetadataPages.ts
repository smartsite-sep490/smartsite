import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiError, type Page } from '@smartsite/api-client';

export function useZoneMetadataPages<T extends { id: string }>({
  queryKey,
  read,
  enabled,
}: {
  queryKey: (string | number)[];
  read: (offset: number, signal: AbortSignal) => Promise<Page<T>>;
  enabled: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      const page = await read(pageParam, signal);
      if (
        !page ||
        !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        page.items.length > 100 ||
        page.items.some((item) => !item || typeof item.id !== 'string' || !item.id)
      ) {
        throw new ApiError('invalid-response', 'Metadata response is invalid.');
      }
      if (page.items.length === 0 && pageParam < page.total) {
        throw new ApiError('invalid-response', 'Metadata response did not advance.');
      }
      return page;
    },
    initialPageParam: 0,
    getNextPageParam: (page, _pages, offset) => {
      const next = offset + page.items.length;
      return page.items.length && next < page.total ? next : undefined;
    },
    enabled,
    retry: false,
    gcTime: 0,
  });
  const page = useMemo(() => {
    const seen = new Set<string>();
    const items: T[] = [];
    for (const part of query.data?.pages ?? []) {
      for (const item of part.items)
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
    }
    return { items, total: query.data?.pages.at(-1)?.total ?? 0 };
  }, [query.data]);
  const status =
    query.error && typeof query.error === 'object' && 'status' in query.error
      ? query.error.status
      : undefined;
  const revoked = query.isError && typeof status === 'number' && [401, 403, 404].includes(status);
  const retainOnError = query.isFetchNextPageError && !revoked;
  return {
    ...query,
    data: enabled && (!query.isError || retainOnError) ? page : undefined,
    revoked,
    retainOnError,
  };
}
