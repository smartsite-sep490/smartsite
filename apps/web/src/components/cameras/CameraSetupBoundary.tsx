import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

registerFeatureCatalog({
  en: {
    'cameraSetup.routeUnavailable': 'Camera setup could not load. Reload the page to try again.',
    'cameraSetup.reloadPage': 'Reload page',
  },
  vi: {
    'cameraSetup.routeUnavailable':
      'Không tải được màn thiết lập camera. Tải lại trang để thử lại.',
    'cameraSetup.reloadPage': 'Tải lại trang',
  },
});

function LoadFailure({ onReload }: { onReload?: () => void }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <section role="alert" className="rounded-xl border p-5 space-y-3">
      <p>{t('cameraSetup.routeUnavailable')}</p>
      <button
        type="button"
        className="rounded-lg border px-4 py-2"
        onClick={onReload ?? (() => window.location.reload())}
      >
        {t('cameraSetup.reloadPage')}
      </button>
    </section>
  );
}

/** A failed route chunk must leave the authenticated shell usable. No automatic reload. */
export class CameraSetupBoundary extends Component<
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
