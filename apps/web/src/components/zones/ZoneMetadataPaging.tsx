import { useLocale } from '../../i18n/ppe-locale';

interface MetadataQuery {
  isPending: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  retainOnError: boolean;
  hasNextPage: boolean;
  data?: { items: unknown[]; total: number };
  fetchNextPage: (options: { cancelRefetch: boolean }) => Promise<unknown>;
  refetch: () => Promise<unknown>;
}

export function ZoneMetadataPaging({
  query,
  kind,
}: {
  query: MetadataQuery;
  kind: 'sites' | 'cameras' | 'regions';
}) {
  const { t } = useLocale();
  const nextError = query.isError && query.retainOnError;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[#6B6B6B]">
      {query.isPending ? (
        <span role="status">{t(`zonePaging.${kind}.loading`)}</span>
      ) : query.data ? (
        <span>
          {t(`zonePaging.${kind}.loadedCount`, {
            loaded: query.data.items.length,
            total: query.data.total,
          })}
        </span>
      ) : null}
      {query.isError ? (
        <>
          <span role="alert">
            {nextError ? t(`zonePaging.${kind}.errorMore`) : t(`zonePaging.${kind}.errorInitial`)}
          </span>
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => {
              if (nextError) void query.fetchNextPage({ cancelRefetch: false });
              else void query.refetch();
            }}
            className="rounded border px-2 py-1 disabled:opacity-50"
          >
            {nextError ? t(`zonePaging.${kind}.retryMore`) : t(`zonePaging.${kind}.retryInitial`)}
          </button>
        </>
      ) : query.hasNextPage ? (
        <button
          type="button"
          disabled={query.isFetching}
          onClick={() => {
            void query.fetchNextPage({ cancelRefetch: false });
          }}
          className="rounded border px-2 py-1 disabled:opacity-50"
        >
          {query.isFetchingNextPage
            ? t(`zonePaging.${kind}.loadingMore`)
            : t(`zonePaging.${kind}.loadMore`)}
        </button>
      ) : null}
    </div>
  );
}
