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
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600">
      {query.isPending ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
        >
          {t(`zonePaging.${kind}.loading`)}
        </span>
      ) : query.data ? (
        <span className="inline-flex items-center rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
          {t(`zonePaging.${kind}.loadedCount`, {
            loaded: query.data.items.length,
            total: query.data.total,
          })}
        </span>
      ) : null}
      {query.isError ? (
        <>
          <span
            role="alert"
            className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"
          >
            {nextError ? t(`zonePaging.${kind}.errorMore`) : t(`zonePaging.${kind}.errorInitial`)}
          </span>
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => {
              if (nextError) void query.fetchNextPage({ cancelRefetch: false });
              else void query.refetch();
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-50"
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
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {query.isFetchingNextPage
            ? t(`zonePaging.${kind}.loadingMore`)
            : t(`zonePaging.${kind}.loadMore`)}
        </button>
      ) : null}
    </div>
  );
}
