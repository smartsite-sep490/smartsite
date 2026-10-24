export type CommonCatalogs = Record<'en' | 'vi', Record<string, string>>;

export function createCommonCatalogLoader(
  load: () => Promise<CommonCatalogs>,
  apply: (catalogs: CommonCatalogs) => void,
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    if (pending) return pending;
    try {
      pending = load()
        .then(apply)
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
      return pending;
    } catch (error) {
      return Promise.reject(error);
    }
  };
}
