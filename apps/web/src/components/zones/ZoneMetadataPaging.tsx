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
  const nextError = query.isError && query.retainOnError;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[#6B6B6B]">
      {query.isPending ? (
        <span role="status">Loading {kind}…</span>
      ) : query.data ? (
        <span>
          {query.data.items.length} of {query.data.total} {kind} loaded
        </span>
      ) : null}
      {query.isError ? (
        <>
          <span role="alert">
            Cannot load {nextError ? 'more ' : ''}
            {kind}. Try again.
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
            Retry loading {nextError ? 'more ' : ''}
            {kind}
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
          {query.isFetchingNextPage ? `Loading more ${kind}…` : `Load more ${kind}`}
        </button>
      ) : null}
    </div>
  );
}
