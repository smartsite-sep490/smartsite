import React from 'react';
import { useLocation } from 'react-router-dom';
import type { ActiveTab } from './components/layout/AppLayout';
import { PageLoadingFallback, RouteErrorBoundary } from './route-load-boundary';

const LazyAppLayout = React.lazy(() =>
  import('./components/layout/AppLayout').then((m) => ({ default: m.AppLayout })),
);

export interface DeferredAppLayoutProps {
  currentTab?: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onLoadSignOut: () => void;
  children: React.ReactNode;
}

export function DeferredAppLayout({
  currentTab,
  onSelectTab,
  onLoadSignOut,
  children,
}: DeferredAppLayoutProps) {
  const location = useLocation();
  return (
    <RouteErrorBoundary key={location.pathname} onSignOut={onLoadSignOut}>
      <React.Suspense fallback={<PageLoadingFallback onSignOut={onLoadSignOut} />}>
        <LazyAppLayout currentTab={currentTab} onSelectTab={onSelectTab}>
          {children}
        </LazyAppLayout>
      </React.Suspense>
    </RouteErrorBoundary>
  );
}

export { DeferredAppLayout as AppLayout };
