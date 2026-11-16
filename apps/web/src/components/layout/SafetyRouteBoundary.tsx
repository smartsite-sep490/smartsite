import { Component, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

registerFeatureCatalog({
  en: {
    'safetyRoute.loading': 'Loading workspace…',
    'safetyRoute.unavailable': 'This workspace could not load. Reload the page to try again.',
    'safetyRoute.reload': 'Reload page',
  },
  vi: {
    'safetyRoute.loading': 'Đang tải màn làm việc…',
    'safetyRoute.unavailable': 'Không tải được màn làm việc. Tải lại trang để thử lại.',
    'safetyRoute.reload': 'Tải lại trang',
  },
});

function LoadFailure({ onReload }: { onReload?: () => void }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <section role="alert" className="rounded-xl border p-5 space-y-3">
      <p>{t('safetyRoute.unavailable')}</p>
      <button
        type="button"
        className="rounded-lg border px-4 py-2"
        onClick={onReload ?? (() => window.location.reload())}
      >
        {t('safetyRoute.reload')}
      </button>
    </section>
  );
}

class RouteFailureBoundary extends Component<
  { children: ReactNode; onReload?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <LoadFailure onReload={this.props.onReload} /> : this.props.children;
  }
}

/** Mount only after session/role checks; a route failure must not disable shell navigation. */
export function SafetyRouteBoundary({
  children,
  onReload,
}: {
  children: ReactNode;
  onReload?: () => void;
}) {
  const { pathname } = useLocation();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <RouteFailureBoundary key={pathname} onReload={onReload}>
      <Suspense
        fallback={
          <p role="status" aria-live="polite">
            {t('safetyRoute.loading')}
          </p>
        }
      >
        {children}
      </Suspense>
    </RouteFailureBoundary>
  );
}
