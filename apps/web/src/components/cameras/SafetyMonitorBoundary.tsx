import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

registerFeatureCatalog({
  en: {
    'safetyMonitor.routeUnavailable':
      'Safety monitoring could not load. Reload the page to try again.',
    'safetyMonitor.reloadPage': 'Reload page',
  },
  vi: {
    'safetyMonitor.routeUnavailable':
      'Không tải được màn giám sát an toàn. Tải lại trang để thử lại.',
    'safetyMonitor.reloadPage': 'Tải lại trang',
  },
});

function LoadFailure({ onReload }: { onReload?: () => void }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <section role="alert" className="rounded-xl border p-5 space-y-3">
      <p>{t('safetyMonitor.routeUnavailable')}</p>
      <button
        type="button"
        className="rounded-lg border px-4 py-2"
        onClick={onReload ?? (() => window.location.reload())}
      >
        {t('safetyMonitor.reloadPage')}
      </button>
    </section>
  );
}

class SafetyMonitorErrorBoundary extends Component<
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

/** A failed monitor route chunk must leave the authenticated shell usable. No automatic reload. */
export function SafetyMonitorBoundary({
  children,
  onReload,
}: {
  children: ReactNode;
  onReload?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <SafetyMonitorErrorBoundary key={pathname} onReload={onReload}>
      {children}
    </SafetyMonitorErrorBoundary>
  );
}
