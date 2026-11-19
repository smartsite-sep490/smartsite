import { useTranslation } from 'react-i18next';
import { userErrorMessage } from '../../i18n/messages';
export function GateCatalogNotice({
  query,
}: {
  query: {
    isPending: boolean;
    error: Error | null;
    data?: { items: unknown[] };
    refetch: () => unknown;
  };
}) {
  const { t } = useTranslation();
  if (query.error)
    return (
      <div role="alert">
        {userErrorMessage(query.error)}{' '}
        <button type="button" onClick={() => void query.refetch()}>
          {t('gateSetup.retry')}
        </button>
      </div>
    );
  if (query.isPending) return <p role="status">{t('gateSetup.loading')}</p>;
  if (!query.data?.items.length) return <p role="status">{t('gateSetup.empty')}</p>;
  return null;
}
